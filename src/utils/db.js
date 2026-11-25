const path = require("path");
const fs = require("fs");
const { createClient } = require("@libsql/client");

// ถ้าตั้งค่า TURSO_DATABASE_URL ไว้ (env var) จะต่อไปที่ฐานข้อมูล Turso บนคลาวด์ (ข้อมูลอยู่ถาวร ไม่หายตอน deploy/restart)
// ถ้าไม่ตั้งไว้ จะ fallback ไปใช้ไฟล์ SQLite ในเครื่อง (เหมาะกับตอนพัฒนา/ทดสอบในเครื่องตัวเอง)
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const LOCAL_DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(process.cwd(), "data/duty.db");

if (!TURSO_URL) {
  fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true });
}

const client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: `file:${LOCAL_DB_PATH}` });

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS members (
    discord_id TEXT PRIMARY KEY,
    discord_name TEXT,
    game_name TEXT,
    department TEXT,
    position TEXT,
    registered_at TEXT,
    badge_number TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS duty_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    name TEXT,
    date TEXT,
    check_in TEXT,
    check_out TEXT,
    hours REAL,
    status TEXT,
    note TEXT,
    paused_ms INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS summary (
    discord_id TEXT PRIMARY KEY,
    name TEXT,
    hours_today REAL,
    hours_week REAL,
    hours_month REAL,
    duty_count INTEGER,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS duty_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS roster_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_summary_history (
    week_key TEXT,
    discord_id TEXT,
    name TEXT,
    hours_week REAL,
    duty_count INTEGER,
    updated_at TEXT,
    PRIMARY KEY (week_key, discord_id)
  )`,

  `CREATE TABLE IF NOT EXISTS application_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    discord_name TEXT,
    department TEXT,
    game_name TEXT,
    age TEXT,
    phone TEXT,
    examiner_name TEXT,
    steam_link TEXT,
    steam_hex TEXT,
    status TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_channel_id TEXT,
    review_message_id TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT,
    message_id TEXT,
    owner_id TEXT,
    title TEXT,
    fine INTEGER,
    participants TEXT,
    image_name TEXT,
    created_at TEXT,
    status TEXT DEFAULT 'active',
    cancelled_by TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS afk_status (
    discord_id TEXT PRIMARY KEY,
    since TEXT
  )`,  // ---------- ระบบเวลาสตอรี่อุ้ม (แยกจากเวรปกติทั้งหมด) ----------
  `CREATE TABLE IF NOT EXISTS story_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    name TEXT,
    date TEXT,
    check_in TEXT,
    check_out TEXT,
    hours REAL,
    status TEXT,
    note TEXT,
    otp_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS story_otp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    created_by TEXT,
    created_at TEXT,
    expires_at TEXT,
    status TEXT DEFAULT 'open',
    closed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS story_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
];

// รายการคอลัมน์ที่อาจต้องเพิ่มเข้า applications ถ้าฐานข้อมูลเดิมถูกสร้างไว้ก่อนที่จะมีฟิลด์เหล่านี้
const APPLICATIONS_MIGRATION_COLUMNS = [
  { name: "age", ddl: "ALTER TABLE applications ADD COLUMN age TEXT" },
  { name: "phone", ddl: "ALTER TABLE applications ADD COLUMN phone TEXT" },
  { name: "examiner_name", ddl: "ALTER TABLE applications ADD COLUMN examiner_name TEXT" },
  { name: "steam_link", ddl: "ALTER TABLE applications ADD COLUMN steam_link TEXT" },
  { name: "steam_hex", ddl: "ALTER TABLE applications ADD COLUMN steam_hex TEXT" },
  { name: "duty_log.note", ddl: "ALTER TABLE duty_log ADD COLUMN note TEXT" },
  { name: "duty_log.paused_ms", ddl: "ALTER TABLE duty_log ADD COLUMN paused_ms INTEGER DEFAULT 0" },
  { name: "afk_status.since", ddl: "ALTER TABLE afk_status ADD COLUMN since TEXT" },
  { name: "members.badge_number", ddl: "ALTER TABLE members ADD COLUMN badge_number TEXT" },
  // ประเภทคดี (เช่น "อุ้มห่อ") — ว่าง = คดีทั่วไป
  { name: "cases.case_type", ddl: "ALTER TABLE cases ADD COLUMN case_type TEXT" },
  // คอลัมน์ของตาราง cases (กรณีสร้างตารางไว้ก่อนมีระบบยกเลิกเคส)
  { name: "cases.status", ddl: "ALTER TABLE cases ADD COLUMN status TEXT DEFAULT 'active'" },
  { name: "cases.cancelled_by", ddl: "ALTER TABLE cases ADD COLUMN cancelled_by TEXT" },
  { name: "cases.cancelled_at", ddl: "ALTER TABLE cases ADD COLUMN cancelled_at TEXT" },
  { name: "cases.cancel_reason", ddl: "ALTER TABLE cases ADD COLUMN cancel_reason TEXT" },
];

const ready = (async () => {
  if (!TURSO_URL) {
    await client.execute("PRAGMA journal_mode = WAL;");
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }
  // เผื่อฐานข้อมูลเดิมถูกสร้างไว้ก่อนมีคอลัมน์ใหม่ (age, phone, examiner_name) ให้เพิ่มให้อัตโนมัติ
  for (const column of APPLICATIONS_MIGRATION_COLUMNS) {
    try {
      await client.execute(column.ddl);
    } catch (err) {
      // ถ้าคอลัมน์มีอยู่แล้วจะ error แบบ "duplicate column name" ซึ่งข้ามได้อย่างปลอดภัย
      if (!/duplicate column/i.test(err.message)) {
        console.error(`[db] เพิ่มคอลัมน์ ${column.name} ไม่สำเร็จ:`, err.message);
      }
    }
  }
  await normalizeExistingBadges();
  await backfillBadgeNumbers();
  console.log(
    TURSO_URL
      ? "[db] เชื่อมต่อ Turso (คลาวด์) เรียบร้อย — ข้อมูลจะไม่หายตอน deploy/restart"
      : "[db] ใช้ไฟล์ SQLite ในเครื่อง (local) — ตั้ง TURSO_DATABASE_URL ถ้าต้องการเก็บถาวรบน Render"
  );
})();

// ---------- แปลงชื่อคอลัมน์ snake_case (ในฐานข้อมูล) <-> camelCase (ที่ไฟล์คำสั่งใช้อยู่เดิม) ----------

// ---------- เลขประจำตัว (badge number) ----------
// ออกอัตโนมัติตอนสมัคร โดยให้ "เลขน้อยที่สุดที่ว่าง" ก่อนเสมอ ไม่ซ้ำกัน
// เช่น มี 1, 3 (2 ลาออกไปแล้ว) → คนใหม่ได้ 2, คนถัดไปได้ 4 (รหัสตัวเดียว เริ่มที่ 1)
// สมาชิกเดิมที่ยังไม่มีเลขจะได้รับเลขตามลำดับวันที่สมัคร (เติมช่องว่างจากน้อยไปมากเช่นกัน)
// รหัสเป็นตัวเลขล้วน → ตัดศูนย์นำหน้า ("001" → "1") ถ้าไม่ใช่ตัวเลขล้วนคงเดิม
function normalizeBadge(v) {
  const str = String(v ?? "").trim();
  return /^\d+$/.test(str) ? String(parseInt(str, 10)) : str;
}

let migratedBadgeIds = [];
/** รายชื่อ discordId ที่ถูกแปลงรหัสจาก 001 → 1 ตอนบอทเริ่ม (ให้ index.js ไปอัปเดตชื่อเล่นในดิสคอร์ด) — อ่านแล้วเคลียร์ */
function takeMigratedBadgeIds() {
  const ids = migratedBadgeIds;
  migratedBadgeIds = [];
  return ids;
}

/** แปลงรหัสเดิมที่มีศูนย์นำหน้า (001, 003) เป็นรหัสตัวเดียว (1, 3) — ข้ามถ้าชนกับรหัสของคนอื่น */
async function normalizeExistingBadges() {
  const { rows } = await client.execute("SELECT discord_id, badge_number FROM members WHERE badge_number IS NOT NULL AND badge_number != ''");
  const taken = new Set(rows.map((r) => String(r.badge_number)));
  for (const r of rows) {
    const old = String(r.badge_number);
    const fixed = normalizeBadge(old);
    if (fixed === old) continue;
    if (taken.has(fixed)) {
      console.warn(`[db] รหัส ${old} แปลงเป็น ${fixed} ไม่ได้ เพราะมีคนใช้ ${fixed} อยู่แล้ว — ให้แอดมินแก้ด้วย /เปลี่ยนเลขนำหน้า`);
      continue;
    }
    await client.execute({ sql: "UPDATE members SET badge_number = ? WHERE discord_id = ?", args: [fixed, r.discord_id] });
    taken.delete(old);
    taken.add(fixed);
    migratedBadgeIds.push(r.discord_id);
  }
  if (migratedBadgeIds.length > 0) console.log(`[db] แปลงรหัสประจำตัวเป็นรหัสตัวเดียว ${migratedBadgeIds.length} คน`);
}

function smallestFreeNumber(usedValues) {
  const used = new Set();
  for (const v of usedValues) {
    const str = String(v ?? "");
    if (/^\d+$/.test(str)) used.add(parseInt(str, 10));
  }
  let n = 1;
  while (used.has(n)) n++;
  return String(n);
}

async function nextBadgeNumber() {
  const { rows } = await client.execute("SELECT badge_number FROM members WHERE badge_number IS NOT NULL AND badge_number != ''");
  return smallestFreeNumber(rows.map((r) => r.badge_number));
}

async function backfillBadgeNumbers() {
  const { rows } = await client.execute(
    "SELECT discord_id FROM members WHERE badge_number IS NULL OR badge_number = '' ORDER BY registered_at, rowid"
  );
  for (const r of rows) {
    const badge = await nextBadgeNumber();
    await client.execute({ sql: "UPDATE members SET badge_number = ? WHERE discord_id = ?", args: [badge, r.discord_id] });
  }
  if (rows.length > 0) console.log(`[db] ออกเลขประจำตัวให้สมาชิกเดิม ${rows.length} คน`);
}

function rowToMember(row) {
  if (!row) return null;
  return {
    discordId: row.discord_id,
    discordName: row.discord_name,
    gameName: row.game_name,
    department: row.department,
    position: row.position,
    registeredAt: row.registered_at,
    badgeNumber: row.badge_number || null,
  };
}

function rowToDuty(row) {
  if (!row) return null;
  return {
    _rowNumber: row.id,
    discordId: row.discord_id,
    name: row.name,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out ?? "-",
    hours: row.hours ?? "",
    status: row.status,
    pausedMs: Number(row.paused_ms) || 0, // เวลาที่หยุดเดินสะสมจากการกด วอ.12 (มิลลิวินาที)
  };
}

// ---------- Members ----------

async function findMember(discordId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM members WHERE discord_id = ?",
    args: [discordId],
  });
  return rowToMember(rows[0]);
}

async function addMember(data) {
  await ready;
  const badgeNumber = data.badgeNumber ? normalizeBadge(data.badgeNumber) : await nextBadgeNumber();
  await client.execute({
    sql: `INSERT INTO members (discord_id, discord_name, game_name, department, position, registered_at, badge_number)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.discordId,
      data.discordName,
      data.gameName,
      data.department ?? null,
      data.position,
      data.registeredAt,
      badgeNumber,
    ],
  });
  return badgeNumber; // เลขประจำตัวที่ออกให้
}

async function findMemberByBadgeNumber(badgeNumber) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM members WHERE badge_number = ?",
    args: [normalizeBadge(badgeNumber)],
  });
  return rowToMember(rows[0]);
}

async function updateMemberBadgeNumber(discordId, badgeNumber) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE members SET badge_number = ? WHERE discord_id = ?",
    args: [normalizeBadge(badgeNumber), discordId],
  });
  return Number(result.rowsAffected) > 0;
}

async function getAllMembers() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM members ORDER BY game_name COLLATE NOCASE");
  return rows.map(rowToMember);
}

async function updateMemberPosition(discordId, position) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE members SET position = ? WHERE discord_id = ?",
    args: [position, discordId],
  });
  return Number(result.rowsAffected) > 0;
}

async function updateMemberName(discordId, gameName) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE members SET game_name = ? WHERE discord_id = ?",
    args: [gameName, discordId],
  });
  return Number(result.rowsAffected) > 0;
}

async function removeMember(discordId) {
  await ready;
  const result = await client.execute({
    sql: "DELETE FROM members WHERE discord_id = ?",
    args: [discordId],
  });
  return Number(result.rowsAffected) > 0;
}

// ---------- Duty Log ----------

async function getDutyLogs(discordId = null) {
  await ready;
  const { rows } = discordId
    ? await client.execute({ sql: "SELECT * FROM duty_log WHERE discord_id = ? ORDER BY id", args: [discordId] })
    : await client.execute("SELECT * FROM duty_log ORDER BY id");
  return rows.map(rowToDuty);
}

async function findOpenDuty(discordId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM duty_log WHERE discord_id = ? AND status = 'เข้าเวร' ORDER BY id DESC LIMIT 1",
    args: [discordId],
  });
  return rowToDuty(rows[0]);
}

async function getAllOpenDuty() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM duty_log WHERE status = 'เข้าเวร' ORDER BY id");
  return rows.map(rowToDuty);
}

async function addCheckIn(data) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
          VALUES (?, ?, ?, ?, NULL, NULL, 'เข้าเวร')`,
    args: [data.discordId, data.name, data.date, data.checkIn],
  });
}

async function setCheckOut(rowNumber, checkOutIso, hours, pausedMs = null, note = null) {
  await ready;
  await client.execute({
    sql: "UPDATE duty_log SET check_out = ?, hours = ?, status = 'ออกเวร', paused_ms = COALESCE(?, paused_ms), note = COALESCE(?, note) WHERE id = ?",
    args: [checkOutIso, hours, pausedMs, note, rowNumber],
  });
}

async function clearDutyStatus(discordId) {
  await ready;
  const open = await findOpenDuty(discordId);
  if (!open) return false;
  await client.execute({
    sql: "UPDATE duty_log SET status = 'ล้างแล้ว (แอดมิน)' WHERE id = ?",
    args: [open._rowNumber],
  });
  return true;
}

/**
 * แอดมินตัดเวรค้าง: ปิดแถวที่ยัง "เข้าเวร" ค้างอยู่ให้เป็น 'ล้างแล้ว (แอดมิน)' ทันที
 * (ไม่นับชั่วโมงของกะนั้นเลย = 0 ชม. และไม่นับจำนวนครั้งเข้าเวร)
 * note = หมายเหตุที่แอดมินระบุ (บังคับกรอกที่หน้าจอ) เก็บไว้ในคอลัมน์ note ของแถวนั้น
 * discordIds = อาร์เรย์ discord id ที่จะตัด, ถ้าไม่ส่งมา (null) = ตัดทุกคนที่เข้าเวรค้างอยู่ — คืนค่าจำนวนแถวที่ถูกตัด
 */
async function cutOpenDuty(discordIds = null, note = null) {
  await ready;
  if (Array.isArray(discordIds)) {
    if (discordIds.length === 0) return 0;
    const marks = discordIds.map(() => "?").join(",");
    const result = await client.execute({
      sql: `UPDATE duty_log SET status = 'ล้างแล้ว (แอดมิน)', note = ? WHERE status = 'เข้าเวร' AND discord_id IN (${marks})`,
      args: [note, ...discordIds],
    });
    await client.execute({ sql: `DELETE FROM afk_status WHERE discord_id IN (${marks})`, args: discordIds });
    return Number(result.rowsAffected) || 0;
  }
  const result = await client.execute({
    sql: "UPDATE duty_log SET status = 'ล้างแล้ว (แอดมิน)', note = ? WHERE status = 'เข้าเวร'",
    args: [note],
  });
  await client.execute("DELETE FROM afk_status");
  return Number(result.rowsAffected) || 0;
}

/**
 * ลบข้อมูล duty_log ที่ "ปิดรายการแล้ว" ทั้งหมดออกจากฐานข้อมูลจริงๆ
 * (สถานะ ออกเวร / ล้างแล้ว (แอดมิน) / ปรับเพิ่ม / ปรับลด)
 * จะไม่ลบแถวที่ยังมีสถานะ "เข้าเวร" (กำลังเข้าเวรค้างอยู่) เพื่อกันข้อมูลกะที่ทำงานอยู่หาย
 * ใช้กับระบบเคลียร์ฐานข้อมูลรายสัปดาห์แบบแอดมินสั่งเอง — คืนค่าจำนวนแถวที่ถูกลบ
 */
async function clearClosedDutyLogs() {
  await ready;
  const result = await client.execute("DELETE FROM duty_log WHERE status != 'เข้าเวร'");
  return Number(result.rowsAffected) || 0;
}

async function editDutyTime(rowNumber, checkInIso, checkOutIso, hours) {
  await ready;
  if (checkOutIso) {
    await client.execute({
      sql: "UPDATE duty_log SET check_in = ?, check_out = ?, hours = ? WHERE id = ?",
      args: [checkInIso, checkOutIso, hours, rowNumber],
    });
  } else {
    await client.execute({
      sql: "UPDATE duty_log SET check_in = ? WHERE id = ?",
      args: [checkInIso, rowNumber],
    });
  }
}

async function addManualAdjustment(discordId, name, hoursDelta, note, dateStr) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_log (discord_id, name, date, check_in, check_out, hours, status)
          VALUES (?, ?, ?, '-', '-', ?, ?)`,
    args: [
      discordId,
      name,
      dateStr,
      hoursDelta,
      hoursDelta >= 0 ? `ปรับเพิ่ม (${note || "-"})` : `ปรับลด (${note || "-"})`,
    ],
  });
}

// ---------- Summary ----------

async function writeSummaryRow(dataObj) {
  await ready;
  await client.execute({
    sql: `INSERT INTO summary (discord_id, name, hours_today, hours_week, hours_month, duty_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            name = excluded.name,
            hours_today = excluded.hours_today,
            hours_week = excluded.hours_week,
            hours_month = excluded.hours_month,
            duty_count = excluded.duty_count,
            updated_at = excluded.updated_at`,
    args: [
      dataObj.discordId,
      dataObj.name,
      dataObj.hoursToday,
      dataObj.hoursWeek,
      dataObj.hoursMonth,
      dataObj.dutyCount,
      dataObj.updatedAt,
    ],
  });
}

// ---------- Duty Panel (ปุ่มเข้าเวร/ออกเวรแบบข้อความปักหมุด) ----------

async function getPanelMessage() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM duty_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setPanelMessage(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO duty_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

// ---------- Application Panel (ปุ่มสมัครเข้าหน่วยงานแบบข้อความปักหมุด) ----------

async function getApplicationPanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM application_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setApplicationPanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO application_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

// ---------- Roster Panel (ห้องรายชื่อ) ----------

async function getRosterPanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM roster_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setRosterPanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO roster_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

// ---------- Bot State ----------

async function getState(key) {
  await ready;
  const { rows } = await client.execute({ sql: "SELECT value FROM bot_state WHERE key = ?", args: [key] });
  return rows[0] ? rows[0].value : null;
}

async function setState(key, value) {
  await ready;
  await client.execute({
    sql: `INSERT INTO bot_state (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

// ---------- Weekly Summary History (เก็บสรุปชั่วโมงเวรแยกตามสัปดาห์ ดูย้อนหลังได้) ----------

function rowToWeeklyHistory(row) {
  return {
    weekKey: row.week_key,
    discordId: row.discord_id,
    name: row.name,
    hoursWeek: row.hours_week,
    dutyCount: row.duty_count,
    updatedAt: row.updated_at,
  };
}

/**
 * บันทึกสรุปของสัปดาห์ที่ระบุ (ต่อสมาชิกแต่ละคน) ลงตารางประวัติ แบบ "สะสม" ไม่ใช่เขียนทับ
 * เพราะระบบเคลียร์ฐานข้อมูลรายสัปดาห์เป็นแบบแอดมินสั่งเอง อาจสั่งเคลียร์หลายครั้งในสัปดาห์เดียวกันได้
 * (เช่น เคลียร์ระหว่างสัปดาห์บางส่วน แล้วเคลียร์อีกทีตอนจบสัปดาห์จริง) ยอดของสัปดาห์เดียวกัน+สมาชิกเดิม
 * จะถูกบวกสะสมเข้าไปเรื่อยๆ ไม่ถูกเขียนทับ จนกว่าจะขึ้นสัปดาห์ใหม่ (weekKey เปลี่ยน)
 * rows: [{ discordId, name, hoursWeek, dutyCount }]
 */
async function saveWeeklyHistory(weekKey, rows, updatedAt) {
  await ready;
  for (const row of rows) {
    await client.execute({
      sql: `INSERT INTO weekly_summary_history (week_key, discord_id, name, hours_week, duty_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(week_key, discord_id) DO UPDATE SET
              name = excluded.name,
              hours_week = weekly_summary_history.hours_week + excluded.hours_week,
              duty_count = weekly_summary_history.duty_count + excluded.duty_count,
              updated_at = excluded.updated_at`,
      args: [weekKey, row.discordId, row.name, row.hoursWeek, row.dutyCount, updatedAt],
    });
  }
}

async function getWeeklyHistory(weekKey) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM weekly_summary_history WHERE week_key = ? ORDER BY hours_week DESC",
    args: [weekKey],
  });
  return rows.map(rowToWeeklyHistory);
}

/**
 * รายชื่อสัปดาห์ที่เคยบันทึกประวัติไว้ เรียงจากล่าสุดไปเก่าสุด พร้อมยอดรวมของแต่ละสัปดาห์
 */
async function listWeeklyHistoryWeeks(limit = 25) {
  await ready;
  const { rows } = await client.execute({
    sql: `SELECT week_key, SUM(hours_week) AS total_hours, COUNT(*) AS member_count
          FROM weekly_summary_history
          GROUP BY week_key
          ORDER BY week_key DESC
          LIMIT ?`,
    args: [limit],
  });
  return rows.map((r) => ({
    weekKey: r.week_key,
    totalHours: Math.round((r.total_hours || 0) * 1000000) / 1000000,
    memberCount: r.member_count,
  }));
}

// ---------- ระบบใบสมัคร (สมัครเข้าหน่วยงาน ผ่านปุ่ม + ห้องผู้อนุมัติ) ----------

function rowToApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    discordId: row.discord_id,
    discordName: row.discord_name,
    department: row.department,
    gameName: row.game_name,
    age: row.age,
    phone: row.phone,
    examinerName: row.examiner_name,
    steamLink: row.steam_link,
    steamHex: row.steam_hex,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewChannelId: row.review_channel_id,
    reviewMessageId: row.review_message_id,
    createdAt: row.created_at,
  };
}

async function findPendingApplication(discordId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM applications WHERE discord_id = ? AND status = 'รอตรวจสอบ' LIMIT 1",
    args: [discordId],
  });
  return rowToApplication(rows[0]);
}

async function addApplication(entry) {
  await ready;
  const result = await client.execute({
    sql: `INSERT INTO applications (discord_id, discord_name, department, game_name, age, phone, examiner_name, steam_link, steam_hex, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'รอตรวจสอบ', ?)`,
    args: [
      entry.discordId,
      entry.discordName,
      entry.department,
      entry.gameName,
      entry.age,
      entry.phone,
      entry.examinerName,
      entry.steamLink,
      entry.steamHex || null,
      entry.createdAt,
    ],
  });
  return getApplication(Number(result.lastInsertRowid));
}

async function getApplication(id) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM applications WHERE id = ?",
    args: [id],
  });
  return rowToApplication(rows[0]);
}

async function setApplicationReviewMessage(id, channelId, messageId) {
  await ready;
  await client.execute({
    sql: "UPDATE applications SET review_channel_id = ?, review_message_id = ? WHERE id = ?",
    args: [channelId, messageId, id],
  });
}

/** อัปเดตผลการพิจารณา คืนค่า null ถ้าใบสมัครนี้ถูกตัดสินไปแล้ว (กันกดซ้ำ) */
async function decideApplication(id, status, reviewerId, reviewedAt) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE applications SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'รอตรวจสอบ'",
    args: [status, reviewerId, reviewedAt, id],
  });
  if (Number(result.rowsAffected) === 0) return null;
  return getApplication(id);
}

// ---------- Cases (บันทึกคดี) ----------

function rowToCase(row) {
  if (!row) return null;
  let participants = [];
  try { participants = JSON.parse(row.participants || "[]"); } catch { participants = []; }
  return {
    id: Number(row.id),
    channelId: row.channel_id,
    messageId: row.message_id,
    ownerId: row.owner_id,
    title: row.title,
    participants,
    imageName: row.image_name,
    caseType: row.case_type || null,
    createdAt: row.created_at,
    status: row.status || "active",
    cancelledBy: row.cancelled_by || null,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
  };
}

async function addCase(c) {
  await ready;
  const res = await client.execute({
    sql: `INSERT INTO cases (channel_id, message_id, owner_id, title, participants, image_name, created_at, case_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [c.channelId, c.messageId, c.ownerId, c.title, JSON.stringify(c.participants), c.imageName || null, c.createdAt, c.caseType || null],
  });
  return Number(res.lastInsertRowid);
}

async function setCaseMessage(id, messageId) {
  await ready;
  await client.execute({ sql: "UPDATE cases SET message_id = ? WHERE id = ?", args: [messageId, id] });
}

async function getCaseByMessage(messageId) {
  await ready;
  const { rows } = await client.execute({ sql: "SELECT * FROM cases WHERE message_id = ?", args: [messageId] });
  return rowToCase(rows[0]);
}

async function updateCase(id, { title, participants }) {
  await ready;
  await client.execute({
    sql: "UPDATE cases SET title = ?, participants = ? WHERE id = ?",
    args: [title, JSON.stringify(participants), id],
  });
}

async function cancelCase(id, cancelledBy, reason, cancelledAt) {
  await ready;
  await client.execute({
    sql: "UPDATE cases SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, cancelled_at = ? WHERE id = ?",
    args: [cancelledBy, reason, cancelledAt, id],
  });
}

async function getAllCases() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM cases WHERE message_id != 'pending' ORDER BY id");
  return rows.map(rowToCase);
}

async function getLastCaseByOwner(ownerId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM cases WHERE owner_id = ? AND status = 'active' AND message_id != 'pending' ORDER BY id DESC LIMIT 1",
    args: [ownerId],
  });
  return rowToCase(rows[0]);
}

async function deleteCase(id) {
  await ready;
  await client.execute({ sql: "DELETE FROM cases WHERE id = ?", args: [id] });
}

// ---------- AFK (ไม่อยู่หน้าจอ) ----------

async function getAfkIds() {
  await ready;
  const { rows } = await client.execute("SELECT discord_id FROM afk_status");
  return rows.map((r) => r.discord_id);
}

/**
 * วอ.12 (isAfk = true): เริ่มหยุดเดินเวลา — บันทึกเวลาที่เริ่มพักไว้ใน afk_status.since
 * วอ.4 (isAfk = false): เวลาเดินต่อ — เอาช่วงที่พักไปบวกเข้า paused_ms ของกะที่เปิดอยู่
 * (ตอนออกเวร ชั่วโมง = เวลาทั้งหมด - paused_ms) คืนค่าจำนวนมิลลิวินาทีที่พักในรอบนี้
 */
async function setAfk(discordId, isAfk) {
  await ready;
  if (isAfk) {
    await client.execute({
      sql: "INSERT OR IGNORE INTO afk_status (discord_id, since) VALUES (?, ?)",
      args: [discordId, new Date().toISOString()],
    });
    return 0;
  }

  const { rows } = await client.execute({ sql: "SELECT since FROM afk_status WHERE discord_id = ?", args: [discordId] });
  const since = rows[0]?.since;
  let pausedMs = 0;
  if (since) {
    pausedMs = Math.max(0, Date.now() - new Date(since).getTime());
    await client.execute({
      sql: `UPDATE duty_log SET paused_ms = COALESCE(paused_ms, 0) + ?
            WHERE id = (SELECT id FROM duty_log WHERE discord_id = ? AND status = 'เข้าเวร' ORDER BY id DESC LIMIT 1)`,
      args: [pausedMs, discordId],
    });
  }
  await client.execute({ sql: "DELETE FROM afk_status WHERE discord_id = ?", args: [discordId] });
  return pausedMs;
}

/** เวลาที่เริ่ม วอ.12 (ISO) ของสมาชิก หรือ null ถ้าไม่ได้อยู่ วอ.12 */
async function getAfkSince(discordId) {
  await ready;
  const { rows } = await client.execute({ sql: "SELECT since FROM afk_status WHERE discord_id = ?", args: [discordId] });
  return rows[0]?.since || null;
}

/** ลบสถานะ วอ.12 ของสมาชิกตรงๆ (ไม่คำนวณ/ไม่บวก paused_ms) — ใช้ตอนตัดรอบรายสัปดาห์อัตโนมัติ */
async function clearAfk(discordId) {
  await ready;
  await client.execute({ sql: "DELETE FROM afk_status WHERE discord_id = ?", args: [discordId] });
}

/** ตั้งสถานะ วอ.12 โดยกำหนดเวลาเริ่มพักเอง (ใช้ตอนเปิดเวรต่อหลังตัดรอบ 00:00 วันจันทร์) */
async function setAfkSince(discordId, sinceIso) {
  await ready;
  await client.execute({
    sql: "INSERT OR REPLACE INTO afk_status (discord_id, since) VALUES (?, ?)",
    args: [discordId, sinceIso],
  });
}

/** เวลาที่หยุดเดินทั้งหมดของกะที่เปิดอยู่ (มิลลิวินาที) = ที่สะสมไว้แล้ว + วอ.12 ที่ยังไม่ได้กด วอ.4 */
async function getPausedMs(discordId) {
  await ready;
  const open = await findOpenDuty(discordId);
  let total = open ? open.pausedMs : 0;
  const { rows } = await client.execute({ sql: "SELECT since FROM afk_status WHERE discord_id = ?", args: [discordId] });
  if (rows[0]?.since) total += Math.max(0, Date.now() - new Date(rows[0].since).getTime());
  return total;
}

// ---------- ระบบเวลาสตอรี่อุ้ม (แยกจาก duty_log) ----------

function rowToStory(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    discordId: row.discord_id,
    name: row.name,
    date: row.date,
    checkIn: row.check_in,
    checkOut: row.check_out ?? "-",
    hours: row.hours ?? 0,
    status: row.status,
    note: row.note || null,
    otpId: row.otp_id == null ? null : Number(row.otp_id),
  };
}

function rowToOtp(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    status: row.status,
    closedAt: row.closed_at || null,
  };
}

/** เปิด OTP ใหม่ (ปิดอันเก่าที่ยังเปิดอยู่ให้ก่อน — มี OTP เปิดได้ทีละอันเท่านั้น) คืนค่า id ของ OTP ใหม่ */
async function createStoryOtp({ code, createdBy, createdAt, expiresAt }) {
  await ready;
  await client.execute({
    sql: "UPDATE story_otp SET status = 'closed', closed_at = ? WHERE status = 'open'",
    args: [createdAt],
  });
  const res = await client.execute({
    sql: "INSERT INTO story_otp (code, created_by, created_at, expires_at, status) VALUES (?, ?, ?, ?, 'open')",
    args: [code, createdBy, createdAt, expiresAt],
  });
  return Number(res.lastInsertRowid);
}

/** OTP ล่าสุดที่สถานะ open (ยังไม่เช็คหมดเวลา — ให้ชั้นบนเช็ค expiresAt เอง) */
async function getOpenStoryOtp() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM story_otp WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  return rowToOtp(rows[0]);
}

/** ปิด OTP ที่เปิดอยู่ทั้งหมด (ไม่รับคนเข้าเพิ่ม) คืนค่าจำนวนที่ถูกปิด */
async function closeStoryOtp(closedAt) {
  await ready;
  const res = await client.execute({
    sql: "UPDATE story_otp SET status = 'closed', closed_at = ? WHERE status = 'open'",
    args: [closedAt],
  });
  return Number(res.rowsAffected) || 0;
}

async function findOpenStory(discordId) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM story_log WHERE discord_id = ? AND status = 'เข้าสตอรี่' ORDER BY id DESC LIMIT 1",
    args: [discordId],
  });
  return rowToStory(rows[0]);
}

async function getAllOpenStory() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM story_log WHERE status = 'เข้าสตอรี่' ORDER BY id");
  return rows.map(rowToStory);
}

async function addStoryCheckIn({ discordId, name, date, checkIn, otpId }) {
  await ready;
  await client.execute({
    sql: `INSERT INTO story_log (discord_id, name, date, check_in, check_out, hours, status, otp_id)
          VALUES (?, ?, ?, ?, NULL, NULL, 'เข้าสตอรี่', ?)`,
    args: [discordId, name, date, checkIn, otpId ?? null],
  });
}

/** ปิดกะสตอรี่ — คืนค่า false ถ้ากะนี้ถูกปิดไปก่อนแล้ว (กันกดซ้ำ/ตัดซ้อน) */
async function setStoryCheckOut(id, checkOutIso, hours, note = null) {
  await ready;
  const res = await client.execute({
    sql: "UPDATE story_log SET check_out = ?, hours = ?, status = 'ออกสตอรี่', note = COALESCE(?, note) WHERE id = ? AND status = 'เข้าสตอรี่'",
    args: [checkOutIso, hours, note, id],
  });
  return Number(res.rowsAffected) > 0;
}

/**
 * แอดมินตัดเวลาสตอรี่ค้าง (เหมือนตัดเวรปกติ) — ปิดกะเป็น 0 ชม. สถานะ 'ล้างแล้ว (แอดมิน)' + หมายเหตุ
 * discordIds = null → ตัดทุกคนที่ยังอยู่ในสตอรี่ ; ไม่ใช่ 'ออกสตอรี่' จึงไม่ถูกนับในสรุปรายวัน/รายสัปดาห์
 * คืนจำนวนแถวที่ถูกตัด
 */
async function cutOpenStory(discordIds = null, note = null, atIso = null) {
  await ready;
  const at = atIso || new Date().toISOString();
  if (Array.isArray(discordIds)) {
    if (discordIds.length === 0) return 0;
    const marks = discordIds.map(() => "?").join(",");
    const res = await client.execute({
      sql: `UPDATE story_log SET status = 'ล้างแล้ว (แอดมิน)', check_out = ?, hours = 0, note = ? WHERE status = 'เข้าสตอรี่' AND discord_id IN (${marks})`,
      args: [at, note, ...discordIds],
    });
    return Number(res.rowsAffected) || 0;
  }
  const res = await client.execute({
    sql: "UPDATE story_log SET status = 'ล้างแล้ว (แอดมิน)', check_out = ?, hours = 0, note = ? WHERE status = 'เข้าสตอรี่'",
    args: [at, note],
  });
  return Number(res.rowsAffected) || 0;
}

/** ประวัติกะสตอรี่ที่ปิดแล้ว (ออกสตอรี่) ของทุกคน หรือคนเดียว */
async function getClosedStoryLogs(discordId = null) {
  await ready;
  const { rows } = discordId
    ? await client.execute({ sql: "SELECT * FROM story_log WHERE status = 'ออกสตอรี่' AND discord_id = ? ORDER BY id", args: [discordId] })
    : await client.execute("SELECT * FROM story_log WHERE status = 'ออกสตอรี่' ORDER BY id");
  return rows.map(rowToStory);
}

async function getStoryPanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM story_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setStoryPanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO story_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

module.exports = {
  createStoryOtp,
  getOpenStoryOtp,
  closeStoryOtp,
  findOpenStory,
  getAllOpenStory,
  addStoryCheckIn,
  setStoryCheckOut,
  cutOpenStory,
  getClosedStoryLogs,
  getStoryPanel,
  setStoryPanel,
  normalizeBadge,
  takeMigratedBadgeIds,
  smallestFreeNumber,
  findMemberByBadgeNumber,
  updateMemberBadgeNumber,
  addCase,
  cancelCase,
  getAllCases,
  getLastCaseByOwner,
  setCaseMessage,
  getCaseByMessage,
  updateCase,
  deleteCase,
  getAfkIds,
  setAfk,
  getPausedMs,
  clearAfk,
  getAfkSince,
  setAfkSince,
  findMember,
  addMember,
  getAllMembers,
  updateMemberPosition,
  updateMemberName,
  removeMember,
  getDutyLogs,
  findOpenDuty,
  getAllOpenDuty,
  addCheckIn,
  setCheckOut,
  clearDutyStatus,
  cutOpenDuty,
  clearClosedDutyLogs,
  editDutyTime,
  addManualAdjustment,
  writeSummaryRow,
  getPanelMessage,
  setPanelMessage,
  getApplicationPanel,
  setApplicationPanel,
  getRosterPanel,
  setRosterPanel,
  getState,
  setState,
  saveWeeklyHistory,
  getWeeklyHistory,
  listWeeklyHistoryWeeks,
  findPendingApplication,
  addApplication,
  getApplication,
  setApplicationReviewMessage,
  decideApplication,
};
