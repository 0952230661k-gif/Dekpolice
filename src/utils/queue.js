const dayjs = require("dayjs");
const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const { sendLog } = require("./permissions");

const CHECK_INTERVAL_MS = 15 * 1000; // เช็คคนพักหมดเวลาทุก 15 วินาที

/**
 * ระบบคิวแพทย์ผ่าน Discord
 * ดึงรายชื่อจากระบบเช็คชื่อเข้าเวร (เข้าเวรอยู่เท่านั้นถึงจะเข้าคิวได้)
 * สถานะ: ready (พร้อมรับเคส) / on_case (กำลังรับเคส) / break (พัก) / loop (ชุบลูป)
 * ข้อมูลคิว/สถานะทั้งหมดเก็บใน DB ของบอทเอง ไม่พึ่ง Google Sheets
 */

// ---------- แปลงรายชื่อคิวดิบจาก DB ให้พร้อมสำหรับสร้าง Embed ----------
async function buildQueueGroups() {
  const members = await db.getAllQueueMembers();
  const nowIso = time.nowIso();

  const ready = [];
  const onCase = [];
  const onBreak = [];
  const loop = [];

  for (const m of members) {
    if (m.status === "ready") {
      ready.push({ discordId: m.discordId, name: m.name });
    } else if (m.status === "on_case") {
      onCase.push({
        discordId: m.discordId,
        name: m.name,
        startedAtText: `${dayjs(m.caseStartedAt).tz(time.TZ).format("HH:mm")} น.`,
      });
    } else if (m.status === "break") {
      const remaining = Math.max(0, Math.ceil(dayjs(m.breakUntil).diff(dayjs(), "minute", true)));
      onBreak.push({ discordId: m.discordId, name: m.name, remainingMinutes: remaining });
    } else if (m.status === "loop") {
      loop.push({ discordId: m.discordId, name: m.name });
    }
  }

  // เรียงคิวพร้อมรับเคสตามลำดับ FIFO (queue_order เรียงมาจาก DB อยู่แล้ว)
  return { ready, onCase, onBreak, loop, nowIso };
}

// ---------- โพสต์/อัปเดตแผงคิวหลัก ----------
async function postQueuePanel(channel) {
  const groups = await buildQueueGroups();
  const message = await channel.send({
    embeds: [embeds.queueEmbed(groups)],
    components: [embeds.queueMainRow()],
  });
  await db.setQueuePanel(channel.id, message.id);
  return message;
}

async function refreshQueuePanel(client) {
  const panelInfo = await db.getQueuePanel();
  if (!panelInfo) return;

  try {
    const channel = await client.channels.fetch(panelInfo.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panelInfo.messageId);
    if (!message) return;

    const groups = await buildQueueGroups();
    await message.edit({
      embeds: [embeds.queueEmbed(groups)],
      components: [embeds.queueMainRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงคิวแพทย์ได้:", err.message);
  }
}

async function moveToBackReady(discordId) {
  const nowIso = time.nowIso();
  await db.setQueueReady(discordId, nowIso);
  await db.moveQueueMemberToBack(discordId, nowIso);
}

// ---------- เชื่อมกับระบบเช็คชื่อเข้าเวร ----------

/** เรียกทุกครั้งที่มีคนเข้าเวรสำเร็จ — เพิ่มเข้าคิวท้ายสุดด้วยสถานะพร้อมรับเคส ถ้ายังไม่อยู่ในคิว */
async function onCheckedIn(discordUser, member) {
  try {
    await db.addQueueMember(discordUser.id, member.gameName, time.nowIso());
    await refreshQueuePanel(discordUser.client);
  } catch (err) {
    console.error("เพิ่มเข้าคิวแพทย์อัตโนมัติไม่สำเร็จ:", err.message);
  }
}

/**
 * เรียกทุกครั้งที่มีคนออกเวรสำเร็จ
 * ถ้ากำลังรับเคสอยู่ ไม่ลบออกจากคิวทันที — รอให้กดจบเคสก่อน แล้วแจ้งเตือนผู้ดูแล
 * ถ้าไม่ได้กำลังรับเคส ลบออกจากคิวทันที
 */
async function onCheckedOut(discordUser) {
  try {
    const qMember = await db.getQueueMember(discordUser.id);
    if (!qMember) return;

    if (qMember.status === "on_case") {
      await db.setQueueOffDutyPending(discordUser.id, true);
      await sendLog(
        discordUser.client,
        "คิว",
        embeds.adminActionEmbed(
          "⚠️ ออกเวรระหว่างกำลังรับเคส",
          `<@${discordUser.id}> (${qMember.name}) ออกเวรแล้วแต่ยังกำลังรับเคสอยู่ ระบบจะยังไม่นำออกจากคิวจนกว่าจะกดจบเคส`
        )
      );
      return;
    }

    await db.removeQueueMember(discordUser.id);
    await refreshQueuePanel(discordUser.client);
  } catch (err) {
    console.error("อัปเดตคิวแพทย์ตอนออกเวรไม่สำเร็จ:", err.message);
  }
}

// ---------- Action หลักของคิว (ใช้ร่วมกันทั้งปุ่มและคำสั่งแอดมิน) ----------

/** รับเคส (self-service) — ต้องพร้อมรับเคส และต้องอยู่หัวคิวเท่านั้น */
async function takeCase(discordUser) {
  const qMember = await db.getQueueMember(discordUser.id);
  if (!qMember) {
    return { ok: false, reason: "ไม่พบข้อมูลของคุณในคิว กรุณาเข้าเวรก่อน" };
  }
  if (qMember.status !== "ready") {
    return { ok: false, reason: "คุณไม่ได้อยู่ในสถานะที่สามารถรับเคสได้ในตอนนี้" };
  }

  const groups = await buildQueueGroups();
  const front = groups.ready[0];
  if (!front || front.discordId !== discordUser.id) {
    return { ok: false, reason: "ตอนนี้ยังไม่ถึงคิวของคุณ" };
  }

  const nowIso = time.nowIso();
  await db.setQueueOnCase(discordUser.id, nowIso);
  await db.addQueueCaseLog({
    discordId: discordUser.id,
    name: qMember.name,
    action: "รับเคส",
    caseStartedAt: nowIso,
    createdAt: nowIso,
  });
  await refreshQueuePanel(discordUser.client);
  return { ok: true, name: qMember.name };
}

/** บังคับเรียกคนหัวคิวให้รับเคสทันที (ใช้โดยแอดมินผ่าน /queue-next) */
async function forceNextCase(client) {
  const groups = await buildQueueGroups();
  const front = groups.ready[0];
  if (!front) return { ok: false, reason: "ไม่มีใครอยู่ในคิวพร้อมรับเคสตอนนี้" };

  const nowIso = time.nowIso();
  await db.setQueueOnCase(front.discordId, nowIso);
  await db.addQueueCaseLog({
    discordId: front.discordId,
    name: front.name,
    action: "รับเคส (แอดมินเรียก)",
    caseStartedAt: nowIso,
    createdAt: nowIso,
  });
  await refreshQueuePanel(client);
  return { ok: true, discordId: front.discordId, name: front.name };
}

/** จบเคส — คืนกลับไปท้ายคิว (หรือลบออกเลยถ้าออกเวรไปแล้วระหว่างรับเคส) */
async function endCase(discordUser) {
  const qMember = await db.getQueueMember(discordUser.id);
  if (!qMember || qMember.status !== "on_case") {
    return { ok: false, reason: "คุณไม่ได้กำลังรับเคสอยู่" };
  }

  const nowIso = time.nowIso();
  const durationMinutes = Math.round(dayjs(nowIso).diff(dayjs(qMember.caseStartedAt), "minute", true) * 10) / 10;

  await db.addQueueCaseLog({
    discordId: discordUser.id,
    name: qMember.name,
    action: "จบเคส",
    caseStartedAt: qMember.caseStartedAt,
    caseEndedAt: nowIso,
    durationMinutes,
    createdAt: nowIso,
  });

  if (qMember.offDutyPending) {
    await db.removeQueueMember(discordUser.id);
  } else {
    await moveToBackReady(discordUser.id);
  }

  await refreshQueuePanel(discordUser.client);
  return { ok: true, name: qMember.name, durationMinutes };
}

/** เริ่มพัก — ต้องอยู่ในสถานะพร้อมรับเคสก่อนถึงจะพักได้ */
async function startBreak(discordUser, minutes) {
  const qMember = await db.getQueueMember(discordUser.id);
  if (!qMember || qMember.status !== "ready") {
    return { ok: false, reason: "คุณไม่ได้อยู่ในสถานะที่สามารถพักได้ในตอนนี้" };
  }

  const nowIso = time.nowIso();
  const untilIso = dayjs(nowIso).add(minutes, "minute").toISOString();
  await db.setQueueBreak(discordUser.id, nowIso, untilIso, minutes);
  await refreshQueuePanel(discordUser.client);
  return { ok: true, name: qMember.name, minutes };
}

/** สลับสถานะชุบลูป — กดครั้งแรกเริ่มชุบลูป กดซ้ำ (ตอนกำลังชุบลูปอยู่) = หยุดชุบลูป กลับไปท้ายคิว */
async function toggleLoop(discordUser) {
  const qMember = await db.getQueueMember(discordUser.id);
  if (!qMember) {
    return { ok: false, reason: "ไม่พบข้อมูลของคุณในคิว กรุณาเข้าเวรก่อน" };
  }

  if (qMember.status === "loop") {
    await moveToBackReady(discordUser.id);
    await refreshQueuePanel(discordUser.client);
    return { ok: true, name: qMember.name, started: false };
  }

  if (qMember.status !== "ready") {
    return { ok: false, reason: "คุณไม่ได้อยู่ในสถานะที่สามารถเริ่มชุบลูปได้ในตอนนี้" };
  }

  await db.setQueueLoop(discordUser.id, time.nowIso());
  await refreshQueuePanel(discordUser.client);
  return { ok: true, name: qMember.name, started: true };
}

/** กลับเข้าคิว (ใช้ปิดพัก/ชุบลูปก่อนกำหนด หรือจบภารกิจอื่น) */
async function returnToQueue(discordUser) {
  const qMember = await db.getQueueMember(discordUser.id);
  if (!qMember) {
    return { ok: false, reason: "ไม่พบข้อมูลของคุณในคิว กรุณาเข้าเวรก่อน" };
  }
  if (qMember.status === "ready") {
    return { ok: false, reason: "คุณอยู่ในคิวอยู่แล้ว" };
  }
  if (qMember.status === "on_case") {
    return { ok: false, reason: "คุณกำลังรับเคสอยู่ กรุณากดจบเคสก่อน" };
  }

  await moveToBackReady(discordUser.id);
  await refreshQueuePanel(discordUser.client);
  return { ok: true, name: qMember.name };
}

// ---------- ตรวจคนพักหมดเวลาอัตโนมัติ ----------
async function checkExpiredBreaks(client) {
  try {
    const expired = await db.getExpiredBreaks(time.nowIso());
    if (expired.length === 0) return;

    for (const m of expired) {
      await moveToBackReady(m.discordId);
      await sendLog(
        client,
        "คิว",
        embeds.adminActionEmbed(
          "🔔 หมดเวลาพักแล้ว",
          `<@${m.discordId}> (${m.name}) หมดเวลาพักแล้ว — เพิ่มกลับเข้าท้ายคิวเรียบร้อย`
        )
      );
    }

    await refreshQueuePanel(client);
  } catch (err) {
    console.error("[คิวแพทย์] เช็คคนพักหมดเวลาไม่สำเร็จ:", err);
  }
}

function start(client) {
  checkExpiredBreaks(client);
  setInterval(() => checkExpiredBreaks(client), CHECK_INTERVAL_MS);
}

module.exports = {
  start,
  buildQueueGroups,
  postQueuePanel,
  refreshQueuePanel,
  onCheckedIn,
  onCheckedOut,
  takeCase,
  forceNextCase,
  endCase,
  startBreak,
  toggleLoop,
  returnToQueue,
  checkExpiredBreaks,
};
