const dayjs = require("dayjs");
const db = require("./db");
const time = require("./time");

// รอบสัปดาห์ของเคส = รอบเดียวกับเวร: ตัดคืนวันอาทิตย์ 23:59 → สัปดาห์ใหม่เริ่มวันจันทร์ 00:00 (เวลาไทย)
// (นิยามอยู่ที่ time.weekStart() ที่เดียว)
const weekStart = () => time.weekStart();
const monthStart = () => time.monthStart();

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
  const kidnap = (list) => list.filter((c) => c.caseType === "อุ้มห่อ").length;
  return {
    weekKidnap: kidnap(w),
    monthKidnap: kidnap(m),
    totalKidnap: kidnap(active),
    weekOwn: w.filter((c) => c.ownerId === id).length,
    weekHelped: w.filter((c) => c.ownerId !== id).length,
    weekTotal: w.length,
    monthTotal: m.length,
    total: active.length,
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

/**
 * ยอดเคสของทุกคนสำหรับแอดมิน — รวมสมาชิกที่ลงทะเบียนทุกคน (คนที่ยังไม่มีเคสได้ 0) และคนที่มีเคสแต่ไม่อยู่ในรายชื่อแล้ว
 * เรียงตามเคสรวมทั้งหมด (ทำเอง + ช่วยเหลือ, ไม่นับเคสที่ยกเลิก) มากไปน้อย
 * totals.cases = จำนวนเคสจริงในระบบ (1 เคสนับ 1 ครั้ง ไม่ว่ามีผู้ช่วยกี่คน) ส่วนยอดต่อคนนับทุกเคสที่คนนั้นเกี่ยวข้อง
 */
async function allTotals() {
  const cases = await db.getAllCases();
  const members = await db.getAllMembers();
  const ids = new Set(members.map((m) => m.discordId));
  for (const c of cases) {
    if (c.status !== "active") continue;
    ids.add(c.ownerId);
    c.participants.forEach((p) => ids.add(p));
  }
  const rows = [...ids]
    .map((id) => {
      const s = statsFor(cases, id);
      return { id, ...s, own: cases.filter((c) => c.status === "active" && c.ownerId === id).length };
    })
    .sort((a, b) => b.total - a.total || b.own - a.own || b.monthTotal - a.monthTotal);
  const active = cases.filter((c) => c.status === "active");
  return {
    rows,
    totals: {
      cases: active.length,
      kidnap: active.filter((c) => c.caseType === "อุ้มห่อ").length,
      cancelled: cases.length - active.length,
      withCases: rows.filter((r) => r.total > 0).length,
      noCases: rows.filter((r) => r.total === 0).length,
    },
  };
}

/** รายละเอียดเคสของคนเดียว (แอดมินค้นรายคน): ยอดรวม + รายการเคสล่าสุด (ไม่รวมที่ยกเลิก) */
async function personDetail(id, limit = 15) {
  const cases = await db.getAllCases();
  const mine = cases.filter((c) => involves(c, id));
  const active = mine.filter((c) => c.status === "active");
  const s = statsFor(cases, id);
  const recent = [...active]
    .sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf())
    .slice(0, limit)
    .map((c) => ({
      channelId: c.channelId,
      messageId: c.messageId,
      createdAt: c.createdAt,
      role: c.ownerId === id ? "own" : "helped",
      caseType: c.caseType || null,
      title: c.title || "",
    }));
  return {
    ...s,
    own: active.filter((c) => c.ownerId === id).length,
    cancelled: mine.length - active.length,
    recent,
  };
}

function fmtMinutes(hours) {
  const mins = Math.round((hours || 0) * 60);
  if (mins < 60) return `${mins} นาที`;
  return `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`;
}

/**
 * สรุปเคสของสัปดาห์ที่ refDate อยู่ (จันทร์ 00:00 - อาทิตย์ 23:59:59 เวลาไทย) — ไม่อิงเวลาปัจจุบัน
 * จึงได้ผลถูกต้องแม้บอทประมวลผลช้าข้ามเที่ยงคืน คืน { start, end, rows, totals }
 */
async function weekSummary(refDate) {
  const ref = time.toTz(refDate);
  const start = ref.startOf("isoWeek");
  const end = ref.endOf("isoWeek");
  const all = await db.getAllCases();
  const inWeek = all.filter((c) => {
    const t = dayjs(c.createdAt).valueOf();
    return t >= start.valueOf() && t <= end.valueOf();
  });
  const active = inWeek.filter((c) => c.status === "active");

  const byId = new Map();
  const row = (id) => {
    if (!byId.has(id)) byId.set(id, { id, own: 0, helped: 0, total: 0, kidnap: 0 });
    return byId.get(id);
  };
  for (const c of active) {
    const isKidnap = c.caseType === "อุ้มห่อ";
    const people = [c.ownerId, ...c.participants.filter((p) => p !== c.ownerId)];
    for (const id of people) {
      const r = row(id);
      if (id === c.ownerId) r.own += 1;
      else r.helped += 1;
      r.total += 1;
      if (isKidnap) r.kidnap += 1;
    }
  }
  const rows = [...byId.values()].sort((a, b) => b.total - a.total || b.own - a.own || b.kidnap - a.kidnap);
  return {
    start,
    end,
    rows,
    totals: {
      cases: active.length,
      kidnap: active.filter((c) => c.caseType === "อุ้มห่อ").length,
      cancelled: inWeek.length - active.length,
      people: rows.length,
    },
  };
}

module.exports = { personDetail, allTotals, myInfo, leaderboard, fmtMinutes, statsFor, weekSummary };
