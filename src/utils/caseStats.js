const dayjs = require("dayjs");
const db = require("./db");
const time = require("./time");

// รอบสัปดาห์ของเคส: ตัดคืนวันเสาร์ 23:59 → สัปดาห์ใหม่เริ่มวันอาทิตย์ 00:00 (เวลาไทย)
function weekStart() {
  return time.now().startOf("week");
}
function monthStart() {
  return time.now().startOf("month");
}

function involves(c, id) {
  return c.ownerId === id || c.participants.includes(id);
}

function inRange(c, start) {
  return dayjs(c.createdAt).valueOf() >= start.valueOf();
}

/** สถิติเคสของคนเดียว (นับเฉพาะเคสที่ไม่ถูกยกเลิก) */
function statsFor(cases, id) {
  const active = cases.filter((c) => c.status === "active" && involves(c, id));
  const w = active.filter((c) => inRange(c, weekStart()));
  const m = active.filter((c) => inRange(c, monthStart()));
  return {
    weekOwn: w.filter((c) => c.ownerId === id).length,
    weekHelped: w.filter((c) => c.ownerId !== id).length,
    weekTotal: w.length,
    monthTotal: m.length,
    total: active.length,
    totalFine: active.reduce((sum, c) => sum + (c.fine || 0), 0),
  };
}

async function myInfo(id) {
  const cases = await db.getAllCases();
  return statsFor(cases, id);
}

/** อันดับเคสทุกคน เรียงตามเคสสัปดาห์นี้ (รวมทำเอง+ช่วยเหลือ) */
async function leaderboard() {
  const cases = await db.getAllCases();
  const ids = new Set();
  for (const c of cases) {
    if (c.status !== "active") continue;
    ids.add(c.ownerId);
    c.participants.forEach((p) => ids.add(p));
  }
  return [...ids]
    .map((id) => ({ id, ...statsFor(cases, id) }))
    .sort((a, b) => b.weekTotal - a.weekTotal || b.monthTotal - a.monthTotal || b.total - a.total);
}

function fmtMinutes(hours) {
  const mins = Math.round((hours || 0) * 60);
  if (mins < 60) return `${mins} นาที`;
  return `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`;
}

module.exports = { myInfo, leaderboard, fmtMinutes, statsFor };
