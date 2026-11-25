const crypto = require("node:crypto");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../../config.json");
const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const { sendLog } = require("./permissions");

/**
 * ระบบเวลาสตอรี่อุ้ม — แยกจากระบบเวรปกติทั้งหมด (ตาราง story_log ต่างหาก ไม่ปนกับ duty_log)
 *
 * - ใช้กับ "เคสอุ้ม" เท่านั้น: ส่งเคสอุ้มได้เฉพาะคนที่อยู่ในเวลาสตอรี่ และเคสจะดึงทุกคนที่อยู่ในสตอรี่ตอนนั้นเข้าเคสอัตโนมัติ
 * - เข้าเวลาสตอรี่ได้ก็ต่อเมื่อใส่ OTP ที่ "แอดมินเป็นคนเปิด" ให้ถูกต้อง (แอดมินเปิด/ปิด OTP จากแผงแอดมิน)
 * - OTP เปิดได้ทีละอัน มีเวลาหมดอายุ (config.storyOtpMinutes) — OTP คุมแค่ "การเข้า" คนที่เข้าไปแล้วไม่โดนเตะเมื่อ OTP หมดอายุ
 * - สตอรี่ "ไม่ถูกตัดจบอัตโนมัติ" ไม่ว่าจะข้ามวัน/ข้ามสัปดาห์ — จบเมื่อแอดมินกด "จบสตอรี่" (ปิด OTP + ออกให้ทุกคน + สรุปประจำวัน)
 *   สมาชิกกดออกเองได้ทุกเมื่อ
 */

const STATUS_IN = "เข้าสตอรี่";
const KIDNAP = "อุ้มห่อ"; // ประเภทคดีเดียวกับห้องส่งเคสอุ้มห่อ (cases.case_type)

const validId = (id) => id && !String(id).startsWith("ใส่_") && id !== "-";

// ---------- OTP ----------

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

/** รหัสที่แอดมินตั้งเองต้องเป็นตัวเลข/ตัวอักษรอังกฤษ 4-12 ตัว (ไม่สนตัวพิมพ์เล็ก-ใหญ่) */
function normalizeCode(input) {
  return String(input ?? "").trim().toUpperCase();
}
function isValidCode(code) {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

function otpMinutes() {
  const n = Number(config.storyOtpMinutes);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** OTP ที่ใช้งานได้ตอนนี้ (สถานะเปิดและยังไม่หมดเวลา) หรือ null */
async function activeOtp() {
  const otp = await db.getOpenStoryOtp();
  if (!otp) return null;
  if (!time.now().isBefore(time.toTz(otp.expiresAt))) return null;
  return otp;
}

/**
 * แอดมินเปิด OTP — code ว่าง = สุ่ม 6 หลัก, minutes ว่าง = ค่าเริ่มต้นจาก config
 * คืน { ok:true, otp:{id,code,expiresAt} } หรือ { ok:false, message }
 */
async function openOtp(adminId, { code, minutes } = {}) {
  let finalCode = normalizeCode(code);
  if (!finalCode) finalCode = generateCode();
  else if (!isValidCode(finalCode)) {
    return { ok: false, message: "OTP ที่ตั้งเองต้องเป็นตัวเลข/ตัวอักษรอังกฤษ 4-12 ตัว (หรือเว้นว่างให้บอทสุ่มเลข 6 หลักให้)" };
  }
  let mins = otpMinutes();
  if (minutes !== undefined && String(minutes).trim() !== "") {
    mins = Number(minutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
      return { ok: false, message: "เวลาเปิดรับ OTP ต้องเป็นจำนวนนาที 1-1440 (หรือเว้นว่างใช้ค่าเริ่มต้น)" };
    }
  }
  const now = time.now();
  const expiresAt = now.add(mins, "minute").toISOString();
  const id = await db.createStoryOtp({ code: finalCode, createdBy: adminId, createdAt: now.toISOString(), expiresAt });
  return { ok: true, otp: { id, code: finalCode, expiresAt, minutes: mins } };
}

async function closeOtp() {
  return db.closeStoryOtp(time.nowIso());
}

// ---------- กันเดา OTP: ผิดเกิน 5 ครั้งใน 10 นาที ล็อก 10 นาที ----------
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const failMap = new Map(); // discordId -> { fails, firstAt, lockedUntil }

function lockRemainingMs(id) {
  const f = failMap.get(id);
  if (!f || !f.lockedUntil) return 0;
  const left = f.lockedUntil - Date.now();
  if (left <= 0) {
    failMap.delete(id);
    return 0;
  }
  return left;
}
function registerFail(id) {
  const nowMs = Date.now();
  let f = failMap.get(id);
  if (!f || nowMs - f.firstAt > LOCK_MS) f = { fails: 0, firstAt: nowMs, lockedUntil: 0 };
  f.fails += 1;
  if (f.fails >= MAX_FAILS) f.lockedUntil = nowMs + LOCK_MS;
  failMap.set(id, f);
  return f;
}

// ---------- เข้า / ออก ----------

/** เข้าเวลาสตอรี่ด้วย OTP คืน { ok:true, logEmbed, replyText } หรือ { ok:false, message } */
async function checkIn(discordUser, rawCode) {
  const id = discordUser.id;
  const member = await db.findMember(id);
  if (!member) return { ok: false, message: "คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ" };

  if (await db.findOpenStory(id)) return { ok: false, message: "คุณอยู่ในเวลาสตอรี่อยู่แล้ว กรุณาออกก่อนถ้าจะเข้าใหม่" };

  const locked = lockRemainingMs(id);
  if (locked > 0) {
    return { ok: false, message: `ใส่ OTP ผิดหลายครั้งเกินไป ลองใหม่ได้ในอีก ${Math.ceil(locked / 60000)} นาที` };
  }

  const otp = await activeOtp();
  if (!otp) return { ok: false, message: "ตอนนี้ยังไม่มี OTP เปิดอยู่ (หรือหมดเวลาแล้ว) — ต้องให้แอดมินเปิด OTP สตอรี่อุ้มก่อน" };

  if (normalizeCode(rawCode) !== otp.code) {
    const f = registerFail(id);
    const left = MAX_FAILS - f.fails;
    return { ok: false, message: left > 0 ? `OTP ไม่ถูกต้อง (เหลืออีก ${left} ครั้งก่อนถูกล็อกชั่วคราว)` : "OTP ไม่ถูกต้อง — ถูกล็อกการเข้า 10 นาที" };
  }
  failMap.delete(id);

  const nowIso = time.nowIso();
  await db.addStoryCheckIn({ discordId: id, name: member.gameName, date: time.todayStr(), checkIn: nowIso, otpId: otp.id });

  const logEmbed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🎭 เข้าเวลาสตอรี่อุ้ม")
    .setDescription(`<@${id}> **(${embeds.memberDisplayName({ gameName: member.gameName })})** เข้าเวลาสตอรี่อุ้มแล้ว`)
    .addFields({ name: "เวลา", value: time.displayDateTime(nowIso) })
    .setTimestamp();
  return { ok: true, logEmbed, replyText: "เข้าเวลาสตอรี่อุ้มสำเร็จ — เวลาเริ่มนับแล้ว และตอนนี้คุณส่งเคสอุ้มได้" };
}

/** ปิดกะสตอรี่ของแถวที่ระบุ ณ เวลา atIso — คืน { hours, row } หรือ null ถ้ากะนี้ถูกปิดไปก่อนแล้ว */
async function closeRow(row, atIso, note = null) {
  const hours = Math.max(0, time.hoursBetween(row.checkIn, atIso));
  const done = await db.setStoryCheckOut(row.id, atIso, hours, note);
  return done ? { hours, row } : null;
}

async function checkOut(discordUser) {
  const open = await db.findOpenStory(discordUser.id);
  if (!open) return { ok: false, message: "คุณยังไม่ได้อยู่ในเวลาสตอรี่ ไม่สามารถออกได้" };
  const outIso = time.nowIso();
  const res = await closeRow(open, outIso);
  if (!res) return { ok: false, message: "รายการนี้ถูกปิดไปแล้ว" };

  const logEmbed = new EmbedBuilder()
    .setColor(0x992d22)
    .setTitle("🔴 ออกเวลาสตอรี่อุ้ม")
    .setDescription(`<@${discordUser.id}> **(${embeds.memberDisplayName({ gameName: open.name })})** ออกจากเวลาสตอรี่อุ้ม`)
    .addFields(
      { name: "เข้า", value: time.displayDateTime(open.checkIn), inline: true },
      { name: "ออก", value: time.displayDateTime(outIso), inline: true },
      { name: "รวม", value: time.formatDurationThai(res.hours), inline: true }
    )
    .setTimestamp();
  return { ok: true, hours: res.hours, logEmbed, replyText: `ออกเวลาสตอรี่แล้ว — รอบนี้รวม ${time.formatDurationThai(res.hours)}` };
}

/**
 * ปิดกะสตอรี่ที่ค้างอยู่ ณ เวลา atIso (ไม่ระบุ = ตอนนี้) — filter(row) เลือกเฉพาะบางคนได้
 * กะที่เริ่มหลัง atIso ไม่ถูกแตะ คืนรายการ [{ discordId, name, checkIn, hours }]
 */
async function cutAll(note, atIso = time.nowIso(), filter = null) {
  const cut = [];
  for (const row of await db.getAllOpenStory()) {
    if (filter && !filter(row)) continue;
    if (time.toTz(row.checkIn).isAfter(time.toTz(atIso))) continue;
    const res = await closeRow(row, atIso, note);
    if (res) cut.push({ discordId: row.discordId, name: row.name, checkIn: row.checkIn, hours: res.hours });
  }
  return cut;
}

function cutEmbed(title, cut, atIso) {
  const lines = [];
  let len = 0;
  for (const c of cut) {
    const line = `> <@${c.discordId}> — เข้า ${time.toTz(c.checkIn).format("DD/MM HH:mm")} · ออก ${time.toTz(atIso).format("HH:mm")} · รวม ${time.formatDurationThai(c.hours)}`;
    if (len + line.length > 3500) {
      lines.push(`> … และอีก ${cut.length - lines.length} คน`);
      break;
    }
    lines.push(line);
    len += line.length + 1;
  }
  return new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(lines.join("\n") || "-").setTimestamp();
}

/**
 * สรุปสตอรี่ของ "วันนั้น" (วันที่ตามเวลาไทยของ ref): ใครเข้าเวลาสตอรี่บ้าง เข้า-ออกกี่โมง รวมกี่ชั่วโมง และเข้าเคสอุ้มห่อกี่เคสในวันนั้น
 * นับกะที่ปิด (check_out) ในวันนั้น (รวมที่เพิ่งถูกตัดตอนกดจบสตอรี่)
 */
async function dayRows(ref) {
  const day = time.toTz(ref);
  // นับกะที่ "ปิดในวันนั้น" (check_out) — สตอรี่ที่เข้าไว้ข้ามวัน/ข้ามเที่ยงคืนจะไม่หลุดจากสรุป
  const logs = (await db.getClosedStoryLogs()).filter((l) => l.checkOut && time.toTz(l.checkOut).isSame(day, "day"));
  const cases = (await db.getAllCases()).filter((c) => isKidnapCase(c) && time.toTz(c.createdAt).isSame(day, "day"));
  const byId = new Map();
  const row = (id, name) => {
    if (!byId.has(id)) byId.set(id, { id, name: name || id, hours: 0, spans: [], cases: 0 });
    return byId.get(id);
  };
  for (const l of logs) {
    const x = row(l.discordId, l.name);
    x.hours += Number(l.hours) || 0;
    const inT = time.toTz(l.checkIn);
    const outT = time.toTz(l.checkOut);
    x.spans.push(`${inT.format(inT.isSame(outT, "day") ? "HH:mm" : "DD/MM HH:mm")}-${outT.format("HH:mm")}`);
  }
  for (const c of cases) for (const id of new Set([c.ownerId, ...c.participants])) row(id).cases += 1;
  const rows = [...byId.values()].sort((a, b) => b.hours - a.hours || b.cases - a.cases);
  return { rows, totalCases: cases.length, day };
}

function daySummaryEmbed(rows, totalCases, day) {
  const lines = [];
  let len = 0;
  for (const [i, r] of rows.entries()) {
    const line = `**${i + 1}.** <@${r.id}> — ${r.spans.length ? r.spans.join(", ") + " · " : ""}รวม ${time.formatDurationThai(r.hours)} · เคสอุ้มห่อ ${r.cases}`;
    if (len + line.length > 3400) {
      lines.push(`… และอีก ${rows.length - i} คน`);
      break;
    }
    lines.push(line);
    len += line.length + 1;
  }
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🎬 สรุปสตอรี่อุ้ม วันที่ ${day.format("DD/MM/YYYY")}`)
    .setDescription(
      rows.length === 0
        ? "วันนี้ไม่มีใครเข้าเวลาสตอรี่"
        : `เข้าเวลาสตอรี่ **${rows.length}** คน · เคสอุ้มห่อรวม **${totalCases}** เคส\n\n${lines.join("\n")}`
    )
    .setFooter({ text: "เวลาสตอรี่แยกจากเวรปกติ" })
    .setTimestamp();
}

/** แอดมินกด "จบสตอรี่": ปิด OTP + ออกเวลาให้ทุกคนที่ยังอยู่ + สรุปคนเข้าสตอรี่ของวันนั้นลงห้อง log */
async function endStory(client, adminTag) {
  const closed = await closeOtp();
  const atIso = time.nowIso();
  const cut = await cutAll(`แอดมินจบสตอรี่ (${adminTag})`, atIso);
  const { rows, totalCases, day } = await dayRows(atIso);
  const summary = daySummaryEmbed(rows, totalCases, day);
  await sendLog(client, "สตอรี่อุ้ม", summary);
  await refreshPanel(client).catch(() => {});
  return { closedOtp: closed > 0, cut, summary };
}

// ---------- แผงเวลาสตอรี่ (ข้อความปักหมุดในห้อง อัปเดตสด) ----------

async function panelEmbeds() {
  const open = await db.getAllOpenStory();
  const otp = await activeOtp();
  const list = open.length > 0 ? open.map((r) => `> <@${r.discordId}> · เข้า ${time.toTz(r.checkIn).format("HH:mm")} น.`).join("\n") : "-# ไม่มี";
  const otpLine = otp
    ? `🔓 **เปิดรับเข้า** — ใส่ OTP ที่แอดมินแจ้ง (หมดเวลารับเข้า <t:${Math.floor(time.toTz(otp.expiresAt).valueOf() / 1000)}:R>)`
    : "🔒 **ปิดอยู่** — ต้องรอแอดมินเปิด OTP ก่อนถึงจะเข้าได้";
  return [
    new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🎭 เวลาสตอรี่อุ้ม")
      .setDescription(
        `### 🟢 อยู่ในสตอรี่ · ${open.length} คน\n${list.length > 3500 ? list.slice(0, 3490) + "\n…" : list}\n\n` +
          `${otpLine}\n` +
          `-# เวลานี้นับแยกจากเวรปกติ ใช้กับ **เคสอุ้ม** เท่านั้น · ส่งเคสอุ้มได้เฉพาะคนที่อยู่ในสตอรี่ และจะแท็กทุกคนที่อยู่ในสตอรี่เข้าเคสให้อัตโนมัติ\n` +
          `-# อัปเดตล่าสุด <t:${Math.floor(Date.now() / 1000)}:R>`
      ),
  ];
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("story_in").setLabel("เข้าสตอรี่ (ใส่ OTP)").setEmoji("🔑").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("story_out").setLabel("ออกสตอรี่").setEmoji("🔴").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("story_me").setLabel("เวลาของฉัน").setEmoji("⏱️").setStyle(ButtonStyle.Secondary),
    // ปุ่มแอดมิน (เหมือนปุ่ม "แอดมิน" บนแผงเข้าเวร) — ขึ้นต้น ap_ จึงถูกเช็คสิทธิ์แอดมินที่ adminPanelHandler ก่อนเสมอ
    new ButtonBuilder().setCustomId("ap_story_cut").setLabel("แอดมิน").setEmoji("🛡️").setStyle(ButtonStyle.Danger)
  );
}

async function postPanel(channel) {
  const message = await channel.send({ embeds: await panelEmbeds(), components: [panelRow()] });
  await db.setStoryPanel(channel.id, message.id);
  return message;
}

async function refreshPanel(client) {
  const p = await db.getStoryPanel();
  if (!p) return;
  try {
    const channel = await client.channels.fetch(p.channelId);
    const message = channel && (await channel.messages.fetch(p.messageId));
    if (!message) return;
    await message.edit({ embeds: await panelEmbeds(), components: [panelRow()] });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงสตอรี่อุ้มได้:", err.message);
  }
}

// ---------- สถิติ / สรุปรายสัปดาห์ ----------

function isKidnapCase(c) {
  return c.caseType === KIDNAP && c.status === "active" && c.channelId !== "manual";
}

/** สรุปเวลาสตอรี่ของสัปดาห์ที่ ref อยู่ (จันทร์-อาทิตย์ เวลาไทย) พร้อมจำนวนเคสอุ้มของแต่ละคนในสัปดาห์นั้น */
async function weekRows(ref) {
  const r = time.toTz(ref);
  const logs = (await db.getClosedStoryLogs()).filter((l) => time.toTz(l.checkIn).isSame(r, "isoWeek"));
  const cases = (await db.getAllCases()).filter((c) => isKidnapCase(c) && time.toTz(c.createdAt).isSame(r, "isoWeek"));
  const byId = new Map();
  const row = (id, name) => {
    if (!byId.has(id)) byId.set(id, { id, name: name || id, hours: 0, sessions: 0, cases: 0 });
    return byId.get(id);
  };
  for (const l of logs) {
    const x = row(l.discordId, l.name);
    x.hours += Number(l.hours) || 0;
    x.sessions += 1;
  }
  for (const c of cases) {
    for (const id of new Set([c.ownerId, ...c.participants])) row(id).cases += 1;
  }
  const rows = [...byId.values()].sort((a, b) => b.hours - a.hours || b.cases - a.cases);
  return { rows, totalCases: cases.length };
}

function weekSummaryEmbed(rows, totalCases, ref, auto = false) {
  const range = time.weekRangeThai(time.toTz(ref));
  const lines = [];
  let len = 0;
  for (const [i, r] of rows.entries()) {
    const line = `**${i + 1}.** <@${r.id}> — ${time.formatDurationThai(r.hours)} · ${r.sessions} รอบ · เคสอุ้ม ${r.cases}`;
    if (len + line.length > 3400) {
      lines.push(`… และอีก ${rows.length - i} คน`);
      break;
    }
    lines.push(line);
    len += line.length + 1;
  }
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🎭 สรุปเวลาสตอรี่อุ้ม ${range}`)
    .setDescription(
      (rows.length === 0 ? "ไม่มีข้อมูลเวลาสตอรี่ในสัปดาห์นี้" : `${auto ? "ตัดรอบสัปดาห์อัตโนมัติ · " : ""}เคสอุ้มรวม **${totalCases}** เคส · ${rows.length} คน\n\n${lines.join("\n")}`)
    )
    .setFooter({ text: "เวลาสตอรี่แยกจากเวรปกติ · เคสอุ้ม = เคสที่ส่งในห้องเคสอุ้ม" })
    .setTimestamp();
}

/** ยอดของคนเดียว (ปุ่ม "เวลาของฉัน") */
async function myStats(discordId) {
  const logs = await db.getClosedStoryLogs(discordId);
  const nowT = time.now();
  const inWeek = logs.filter((l) => time.toTz(l.checkIn).isSame(nowT, "isoWeek"));
  const weekHours = inWeek.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const cases = (await db.getAllCases()).filter(
    (c) => isKidnapCase(c) && time.toTz(c.createdAt).isSame(nowT, "isoWeek") && (c.ownerId === discordId || c.participants.includes(discordId))
  );
  const open = await db.findOpenStory(discordId);
  let live = 0;
  if (open) live = Math.max(0, time.hoursBetween(open.checkIn, time.nowIso()));
  return { weekHours: weekHours + live, weekSessions: inWeek.length + (open ? 1 : 0), weekCases: cases.length, open };
}

/** ส่งสรุปเวลาสตอรี่รายสัปดาห์ตอน 23:59 วันอาทิตย์ — ไม่ตัดจบ/ไม่ปิด OTP ใคร (สตอรี่จบเมื่อแอดมินกด "จบสตอรี่" เท่านั้น) */
async function weeklyCut(client, cutAt) {
  const { rows, totalCases } = await weekRows(cutAt);
  if (rows.length > 0) await sendLog(client, "สตอรี่อุ้ม", weekSummaryEmbed(rows, totalCases, cutAt, true));
  console.log(`[สตอรี่อุ้ม] ส่งสรุปสัปดาห์ ${rows.length} คน (ไม่ตัดจบเวลาสตอรี่)`);
}

module.exports = {
  KIDNAP,
  validId,
  activeOtp,
  openOtp,
  closeOtp,
  checkIn,
  checkOut,
  cutAll,
  endStory,
  dayRows,
  daySummaryEmbed,
  panelEmbeds,
  postPanel,
  refreshPanel,
  weekRows,
  weekSummaryEmbed,
  myStats,
  weeklyCut,
};
