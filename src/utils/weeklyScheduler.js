const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const panel = require("./panel");
const weeklyReset = require("./weeklyReset");
const { sendLog } = require("./permissions");

/**
 * ตัดรอบเวรรายสัปดาห์อัตโนมัติ
 *
 * 1) 23:59 น. วันอาทิตย์ (เวลาไทย)
 *    - ปิดเวรของทุกคนที่ยังค้างอยู่ ณ 23:59:00 (คิดชั่วโมงถึง 23:59 หักเวลา วอ.12 ให้เหมือนกดออกเวรเอง)
 *    - สรุป + บันทึกประวัติ + เคลียร์ duty_log + ส่งลงห้อง "สรุปสัปดาห์" (ใช้ weeklyReset.runNow ตัวเดียวกับแอดมินสั่งเอง)
 * 2) 00:00 น. วันจันทร์
 *    - คนที่ถูกตัดตอนอาทิตย์ จะถูกเปิดเวรต่อให้อัตโนมัติ เริ่มนับที่ 00:00:00 ตรงๆ (ยอดตัดเป็นของสัปดาห์เก่า
 *      ส่วนที่เหลือไปเริ่มนับเป็นของสัปดาห์ใหม่ = หักลบกันที่รอยต่อสัปดาห์) ถ้าอยู่สถานะ วอ.12 ก็ยังเป็น วอ.12 ต่อ
 *    - รายชื่อที่ต้องเปิดต่อเก็บไว้ใน bot_state จึงไม่หายถ้าบอทรีสตาร์ทช่วงเที่ยงคืน
 *
 * ความปลอดภัย: บันทึกสัปดาห์ที่ตัดไปแล้วใน bot_state (weekly_autocut_done) กันตัดซ้ำ
 * ถ้าบอทออฟไลน์ตอน 23:59 จนข้ามสัปดาห์ไป จะไม่ตัดย้อนหลังเอง (กันยอดเพี้ยน) แต่แจ้งเตือนในห้องแอดมินให้สั่งเคลียร์เอง
 */

const CUT_HOUR = 23;
const CUT_MINUTE = 59;
const TICK_MS = 10 * 1000;

const KEY_DONE = "weekly_autocut_done"; // weekKey ล่าสุดที่ตัดรอบแล้ว
const KEY_RESUME = "weekly_autocut_resume"; // JSON: { resumeAt, members: [{discordId, name, afk}] }

let running = false;

function weekKeyOf(d) {
  return time.isoWeekKey(d);
}

/** เวลาตัดรอบของสัปดาห์ที่ d อยู่: วันอาทิตย์ 23:59:00 */
function cutTimeOf(d) {
  return d.endOf("isoWeek").startOf("day").hour(CUT_HOUR).minute(CUT_MINUTE).second(0).millisecond(0);
}

/** ปิดเวรที่ค้างอยู่ทั้งหมด ณ เวลา cutAt คืนรายชื่อคนที่ต้องเปิดต่อ */
async function cutOpenSessions(cutAt) {
  const cutIso = cutAt.toISOString();
  const open = await db.getAllOpenDuty();
  const afkSince = new Map();
  for (const id of await db.getAfkIds()) afkSince.set(id, null);
  // อ่านเวลาเริ่ม วอ.12 แบบละเอียด
  for (const id of afkSince.keys()) afkSince.set(id, await db.getAfkSince(id));

  const carried = [];
  for (const duty of open) {
    // กะที่เริ่มหลังเวลาตัด (กดเข้าเวรระหว่างรอ tick) ปล่อยไว้ ไม่ตัด
    if (time.toTz(duty.checkIn).isAfter(cutAt)) continue;

    const since = afkSince.get(duty.discordId);
    const isAfk = afkSince.has(duty.discordId);
    let pausedMs = duty.pausedMs || 0;
    if (since) pausedMs += Math.max(0, cutAt.valueOf() - new Date(since).getTime());

    const rawHours = time.hoursBetween(duty.checkIn, cutIso);
    const hours = Math.max(0, Math.round((rawHours - pausedMs / 3600000) * 1000000) / 1000000);

    await db.setCheckOut(duty._rowNumber, cutIso, hours, pausedMs, "ตัดรอบสัปดาห์อัตโนมัติ 23:59 (เปิดเวรต่อ 00:00)");
    await db.clearAfk(duty.discordId);
    carried.push({ discordId: duty.discordId, name: duty.name, afk: isAfk });
  }
  return carried;
}

async function runWeeklyCut(client, cutAt) {
  const weekKey = weekKeyOf(cutAt);
  const resumeAt = cutAt.add(1, "day").startOf("day"); // จันทร์ 00:00:00

  const carried = await cutOpenSessions(cutAt);

  // เก็บรายชื่อเปิดต่อ + กันตัดซ้ำ ก่อนทำขั้นตอนอื่น
  await db.setState(KEY_RESUME, JSON.stringify({ resumeAt: resumeAt.toISOString(), members: carried }));
  await db.setState(KEY_DONE, weekKey);

  try {
    await weeklyReset.runNow(client, { auto: true, carried });
  } catch (err) {
    console.error("[ตัดรอบอัตโนมัติ] สรุป/เคลียร์ไม่สำเร็จ:", err);
    await sendLog(
      client,
      "แอดมิน",
      embeds.errorEmbed(
        `ตัดรอบอัตโนมัติ (${weekKey}) ปิดเวรที่ค้างแล้ว แต่สรุปสัปดาห์/เคลียร์ฐานข้อมูลไม่สำเร็จ — กรุณาสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ ด้วยตนเอง`
      )
    );
  }

  await panel.refreshPanel(client).catch(() => {});
  console.log(`[ตัดรอบอัตโนมัติ] สัปดาห์ ${weekKey} — ตัดเวรค้าง ${carried.length} คน รอเปิดต่อ ${resumeAt.format("DD/MM HH:mm")}`);
}

/** เปิดเวรต่อให้คนที่ถูกตัดตอนอาทิตย์ เมื่อถึง 00:00 วันจันทร์ */
async function resumeIfDue(client) {
  const raw = await db.getState(KEY_RESUME);
  if (!raw) return;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    await db.setState(KEY_RESUME, "");
    return;
  }
  if (!data || !data.resumeAt) {
    await db.setState(KEY_RESUME, "");
    return;
  }

  const resumeAt = time.toTz(data.resumeAt);
  if (time.now().isBefore(resumeAt)) return;

  // เคลียร์คิวก่อน กันเปิดซ้ำถ้ามี tick ซ้อน/บอทรีสตาร์ท
  await db.setState(KEY_RESUME, "");

  const resumeIso = resumeAt.toISOString();
  let resumed = 0;
  for (const m of data.members || []) {
    const already = await db.findOpenDuty(m.discordId);
    if (already) continue; // กดเข้าเวรเองไปก่อนแล้ว
    const member = await db.findMember(m.discordId);
    if (!member) continue; // ถูกลบออกจากระบบระหว่างนั้น
    await db.addCheckIn({
      discordId: m.discordId,
      name: member.gameName || m.name,
      date: resumeAt.format("YYYY-MM-DD"),
      checkIn: resumeIso,
    });
    if (m.afk) await db.setAfkSince(m.discordId, resumeIso);
    resumed += 1;
  }

  await panel.refreshPanel(client).catch(() => {});
  console.log(`[ตัดรอบอัตโนมัติ] เปิดเวรต่อ 00:00 วันจันทร์ ${resumed} คน`);
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    const now = time.now();
    const currentWeek = weekKeyOf(now);
    const lastDone = await db.getState(KEY_DONE);

    // ถึงเวลาตัดรอบ: วันอาทิตย์ 23:59 เป็นต้นไป และยังไม่เคยตัดสัปดาห์นี้
    const cutAt = cutTimeOf(now);
    if (lastDone !== currentWeek && !now.isBefore(cutAt)) {
      await runWeeklyCut(client, cutAt);
    } else if (lastDone && lastDone !== currentWeek && lastDone !== weekKeyOf(now.subtract(1, "week"))) {
      // พลาดการตัดรอบของสัปดาห์ที่แล้ว (บอทออฟไลน์ตอน 23:59) — ไม่ตัดย้อนหลังเอง แจ้งแอดมินแทน
      await db.setState(KEY_DONE, weekKeyOf(now.subtract(1, "week")));
      await sendLog(
        client,
        "แอดมิน",
        embeds.errorEmbed(
          "⚠️ บอทไม่ได้ตัดรอบสัปดาห์ที่ผ่านมาอัตโนมัติ (บอทออฟไลน์ตอน 23:59 น. วันอาทิตย์) — กรุณาตรวจเวรค้างและสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ ด้วยตนเอง"
        )
      );
    }

    await resumeIfDue(client);
  } catch (err) {
    console.error("[ตัดรอบอัตโนมัติ] เกิดข้อผิดพลาด:", err);
  } finally {
    running = false;
  }
}

async function start(client) {
  // ครั้งแรกที่ deploy: ถือว่าสัปดาห์ก่อนหน้าตัดไปแล้ว (กันแจ้งเตือนพลาดรอบเท็จ)
  if (!(await db.getState(KEY_DONE))) {
    await db.setState(KEY_DONE, weekKeyOf(time.now().subtract(1, "week")));
  }
  await tick(client);
  setInterval(() => tick(client), TICK_MS);
  console.log("[ตัดรอบอัตโนมัติ] เปิดใช้งาน: ตัดเวร 23:59 น. วันอาทิตย์ / เปิดเวรต่อ 00:00 น. วันจันทร์");
}

module.exports = { start, tick, runWeeklyCut, resumeIfDue, cutTimeOf };
