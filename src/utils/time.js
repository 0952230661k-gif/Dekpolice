const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const isoWeek = require("dayjs/plugin/isoWeek");
const customParseFormat = require("dayjs/plugin/customParseFormat");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

// ===== เวลาไทยเป็นแหล่งเดียวของทั้งระบบ (เวรทั้งหมดอ้างอิงจากไฟล์นี้) =====
// ตั้ง TZ ของ process ด้วย เพื่อให้ new Date().getHours()/dayjs() เปล่าๆ ก็ได้เวลาไทย
// แม้เซิร์ฟเวอร์ (เช่น Render) จะเป็น UTC
const TZ = "Asia/Bangkok";
process.env.TZ = TZ;
dayjs.tz.setDefault(TZ);

// แปลงค่าเวลาใดๆ เป็น dayjs เวลาไทย
// - ISO เต็มที่มี Z/offset (เช่น 2026-11-15T02:00:00.000Z) → แปลงเป็นเวลาไทย
// - วันที่ล้วน "YYYY-MM-DD" (ฟิลด์ date ของแถวปรับชั่วโมง) → ถือเป็นวันที่ตามเวลาไทย ไม่ใช่เวลาเครื่อง
function toTz(value) {
  if (value && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dayjs.tz(value, TZ);
  }
  return value ? dayjs(value).tz(TZ) : now();
}

function now() {
  return dayjs().tz(TZ);
}

function nowIso() {
  return now().toISOString();
}

function todayStr() {
  return now().format("YYYY-MM-DD");
}

function displayDateTime(iso) {
  if (!iso || iso === "-") return "-";
  return toTz(iso).format("DD/MM/YYYY HH:mm:ss");
}

// วันที่อย่างเดียว (เวลาไทย) เช่น "15/11/2026" ใช้กับฟุตเตอร์ของเคส
function displayDate(iso) {
  return toTz(iso).format("DD/MM/YYYY");
}

// จำนวนวันเต็มตามปฏิทินไทยตั้งแต่ iso ถึงวันนี้ (ใช้คำนวณอายุงาน)
function daysSince(iso) {
  if (!iso) return 0;
  const d = toTz(iso).startOf("day");
  return Math.max(0, now().startOf("day").diff(d, "day"));
}

// ต้นสัปดาห์ (จันทร์ 00:00 เวลาไทย) และต้นเดือน — ใช้นิยามเดียวกันทั้งเวรและเคส
function weekStart() {
  return now().startOf("isoWeek");
}
function monthStart() {
  return now().startOf("month");
}

// เหมือน displayDateTime แต่ใช้ พ.ศ. และมีวินาที ใช้กับข้อความรายชื่อ/ป้ายอัปเดตล่าสุด
function displayThaiDateTime(iso) {
  const d = toTz(iso);
  const buddhistYear = d.year() + 543;
  return `${d.format("DD/MM")}/${buddhistYear} ${d.format("HH:mm:ss")}`;
}

// รองรับการเข้าเวรข้ามวัน: คำนวณจาก timestamp เต็ม ไม่ใช่แค่เวลา
function hoursBetween(checkInIso, checkOutIso) {
  const diffMs = dayjs(checkOutIso).diff(dayjs(checkInIso));
  const hours = diffMs / (1000 * 60 * 60);
  return Math.round(hours * 1000000) / 1000000; // เก็บละเอียดถึง ~3.6 มิลลิวินาที ไม่ปัดเป็นเศษ 0.01 ชม. (36 วินาที)
}

// แปลงชั่วโมงแบบทศนิยม (เช่น 13.88) ให้เป็นข้อความไทย "13 ชม. 52 นาที 48 วินาที"
// ใช้กับหน้าสรุปรายสัปดาห์ให้อ่านง่ายเหมือนระบบเช็คชื่ออื่นๆ
function formatDurationThai(hoursDecimal) {
  const totalSeconds = Math.max(0, Math.round((hoursDecimal || 0) * 3600));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h} ชม. ${m} นาที ${s} วินาที`;
}

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

// แสดงช่วงวันที่ของสัปดาห์ (จันทร์-อาทิตย์) แบบไทย เช่น "03-09 ส.ค. 69"
// ถ้าคาบเกี่ยวคนละเดือน/ปี จะโชว์เดือน(ปี)ของทั้งสองฝั่งให้ครบ เช่น "29 ก.ค. - 04 ส.ค. 69"
function weekRangeThai(refDate) {
  const d = toTz(refDate);
  const start = d.startOf("isoWeek");
  const end = d.endOf("isoWeek");

  const startDay = start.format("DD");
  const endDay = end.format("DD");
  const startMonth = THAI_MONTHS_SHORT[start.month()];
  const endMonth = THAI_MONTHS_SHORT[end.month()];
  const startYearBE = String((start.year() + 543) % 100).padStart(2, "0");
  const endYearBE = String((end.year() + 543) % 100).padStart(2, "0");

  if (start.year() === end.year() && start.month() === end.month()) {
    return `${startDay}-${endDay} ${endMonth} ${endYearBE}`;
  }
  if (start.year() === end.year()) {
    return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYearBE}`;
  }
  return `${startDay} ${startMonth} ${startYearBE} - ${endDay} ${endMonth} ${endYearBE}`;
}

// เหมือน weekRangeThai แต่รับ weekKey แบบ "YYYY-Www" (ที่เก็บไว้ในประวัติ) แทนวันที่ตรงๆ
function weekRangeThaiFromKey(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey || "");
  if (!match) return weekKey;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // 4 มกราคมของปีนั้นอยู่ใน ISO week 1 เสมอ (ตามนิยาม ISO 8601) ใช้เป็นจุดอ้างอิงแล้วกระโดดไปสัปดาห์ที่ต้องการ
  const jan4 = dayjs.tz(`${year}-01-04`, TZ);
  const ref = jan4.isoWeek(week);
  return weekRangeThai(ref);
}

function isSameDay(iso, dateStr) {
  return toTz(iso).format("YYYY-MM-DD") === dateStr;
}

function isSameWeek(iso) {
  return toTz(iso).isSame(now(), "isoWeek");
}

function isSameMonth(iso) {
  return toTz(iso).isSame(now(), "month");
}

// เทียบว่า iso อยู่ในสัปดาห์ (ISO week) เดียวกับ referenceDate (dayjs object) หรือไม่
// ใช้กับระบบสรุป/รีเซ็ตรายสัปดาห์ เพื่อดึงข้อมูลของ "สัปดาห์ที่ผ่านมา" ได้ ไม่ใช่แค่สัปดาห์ปัจจุบัน
function isSameIsoWeekAs(iso, referenceDate) {
  return toTz(iso).isSame(referenceDate, "isoWeek");
}

// รหัสสัปดาห์ เช่น "2026-W31" ใช้เป็น key กันการรันซ้ำของระบบรีเซ็ตรายสัปดาห์
function isoWeekKey(referenceDate) {
  const d = referenceDate.tz ? referenceDate.tz(TZ) : dayjs(referenceDate).tz(TZ);
  return `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, "0")}`;
}

// วันที่อ้างอิงของ "สัปดาห์ล่าสุดที่จบไปแล้วเต็มสัปดาห์" (สัปดาห์ก่อนสัปดาห์ปัจจุบัน)
// ใช้เช็คว่าถึงเวลาต้องสรุป+รีเซ็ตรายสัปดาห์ใหม่หรือยัง
function lastCompletedWeekRef() {
  return now().startOf("isoWeek").subtract(1, "day");
}

/**
 * รวมชั่วโมงเฉพาะของสัปดาห์ที่ระบุ (ใช้กับระบบสรุป/รีเซ็ตรายสัปดาห์อัตโนมัติ)
 * ต่างจาก summarizeLogs ตรงที่ดูเฉพาะยอดสัปดาห์ ไม่ใช่วันนี้/เดือนนี้
 */
function summarizeLogsForWeek(logs, referenceDate) {
  let week = 0;
  let dutyCount = 0;

  for (const log of logs) {
    const hours = parseFloat(log.hours) || 0;
    if (log.status === "ออกเวร" || log.status.startsWith("ปรับเพิ่ม") || log.status.startsWith("ปรับลด")) {
      const refIso = log.checkIn !== "-" ? log.checkIn : log.date;
      if (isSameIsoWeekAs(refIso, referenceDate)) {
        week += hours;
        if (log.status === "ออกเวร") dutyCount += 1;
      }
    }
  }

  return {
    hoursWeek: Math.round(week * 1000000) / 1000000,
    dutyCount,
  };
}

/**
 * รวมชั่วโมงจากรายการ Duty Log (เฉพาะแถวที่ออกเวรแล้ว หรือแถวปรับเพิ่ม/ลด)
 * ใช้เวลา checkIn เป็นตัวอ้างอิงวัน/สัปดาห์/เดือน
 */
function summarizeLogs(logs) {
  let today = 0;
  let week = 0;
  let month = 0;
  let dutyCount = 0;

  for (const log of logs) {
    const hours = parseFloat(log.hours) || 0;
    if (log.status === "ออกเวร" || log.status.startsWith("ปรับเพิ่ม") || log.status.startsWith("ปรับลด")) {
      const refIso = log.checkIn !== "-" ? log.checkIn : log.date;
      if (isSameDay(refIso, todayStr())) today += hours;
      if (isSameWeek(refIso)) week += hours;
      if (isSameMonth(refIso)) month += hours;
      if (log.status === "ออกเวร") dutyCount += 1;
    }
  }

  return {
    hoursToday: Math.round(today * 1000000) / 1000000,
    hoursWeek: Math.round(week * 1000000) / 1000000,
    hoursMonth: Math.round(month * 1000000) / 1000000,
    dutyCount,
  };
}

/**
 * ชั่วโมงของเวรที่ "ยังเปิดอยู่" นับถึงเดี๋ยวนี้ แยกเป็นวันนี้/สัปดาห์นี้/เดือนนี้ (ตัดตามขอบเขตวัน/สัปดาห์/เดือนไทย)
 * หักเวลา วอ.12 (pausedMs) ออกจากแต่ละช่วง (ไม่เกินความยาวช่วงนั้น)
 */
function liveOpenHours(checkInIso, pausedMs = 0) {
  const n = now();
  const start = toTz(checkInIso);
  const windowHours = (windowStart) => {
    const from = start.isAfter(windowStart) ? start : windowStart;
    const ms = Math.max(0, n.diff(from));
    return Math.max(0, ms - Math.min(pausedMs || 0, ms)) / 3600000;
  };
  return {
    today: windowHours(n.startOf("day")),
    week: windowHours(n.startOf("isoWeek")),
    month: windowHours(n.startOf("month")),
  };
}

module.exports = {
  liveOpenHours,
  TZ,
  toTz,
  now,
  nowIso,
  todayStr,
  displayDateTime,
  displayThaiDateTime,
  displayDate,
  daysSince,
  weekStart,
  monthStart,
  hoursBetween,
  formatDurationThai,
  weekRangeThai,
  weekRangeThaiFromKey,
  isSameDay,
  isSameWeek,
  isSameMonth,
  isSameIsoWeekAs,
  isoWeekKey,
  lastCompletedWeekRef,
  summarizeLogs,
  summarizeLogsForWeek,
};
