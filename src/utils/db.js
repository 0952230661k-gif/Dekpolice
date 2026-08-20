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
    badge_number TEXT,
    registered_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS duty_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    name TEXT,
    date TEXT,
    check_in TEXT,
    check_out TEXT,
    hours REAL,
    status TEXT
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

  `CREATE TABLE IF NOT EXISTS vehicle_plates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_number TEXT UNIQUE,
    owner_name TEXT,
    registered_by TEXT,
    registered_by_name TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS plate_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS plate_list_panel (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    channel_id TEXT,
    message_id TEXT
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
    status TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_channel_id TEXT,
    review_message_id TEXT,
    created_at TEXT
  )`,
];

// รายการคอลัมน์ที่อาจต้องเพิ่มเข้า applications ถ้าฐานข้อมูลเดิมถูกสร้างไว้ก่อนที่จะมีฟิลด์เหล่านี้
const APPLICATIONS_MIGRATION_COLUMNS = [
  { name: "age", ddl: "ALTER TABLE applications ADD COLUMN age TEXT" },
  { name: "phone", ddl: "ALTER TABLE applications ADD COLUMN phone TEXT" },
  { name: "examiner_name", ddl: "ALTER TABLE applications ADD COLUMN examiner_name TEXT" },
  { name: "steam_link", ddl: "ALTER TABLE applications ADD COLUMN steam_link TEXT" },
];

// รายการคอลัมน์ที่อาจต้องเพิ่มเข้า members ถ้าฐานข้อมูลเดิมถูกสร้างไว้ก่อนที่จะมีฟิลด์เหล่านี้
const MEMBERS_MIGRATION_COLUMNS = [
  { name: "badge_number", ddl: "ALTER TABLE members ADD COLUMN badge_number TEXT" },
];

const NEXT_BADGE_NUMBER_KEY = "next_badge_number";

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
  // เผื่อฐานข้อมูลเดิมถูกสร้างไว้ก่อนมีคอลัมน์เลขนำหน้า (badge_number) ให้เพิ่มให้อัตโนมัติ
  for (const column of MEMBERS_MIGRATION_COLUMNS) {
    try {
      await client.execute(column.ddl);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) {
        console.error(`[db] เพิ่มคอลัมน์ ${column.name} ไม่สำเร็จ:`, err.message);
      }
    }
  }

  // เติมเลขนำหน้าให้สมาชิกเก่าที่สมัครไว้ก่อนจะมีระบบเลขนำหน้า (บอทรุ่นเก่า) ให้อัตโนมัติแค่ครั้งเดียว
  // เรียงตามวันที่สมัครก่อน-หลัง แล้วไล่เลขให้ต่อเนื่องกันไม่ซ้ำ (001, 002, 003, ...)
  try {
    const { rows: unnumbered } = await client.execute(
      "SELECT discord_id FROM members WHERE badge_number IS NULL OR badge_number = '' ORDER BY registered_at ASC, rowid ASC"
    );
    if (unnumbered.length > 0) {
      const { rows: stateRows } = await client.execute({
        sql: "SELECT value FROM bot_state WHERE key = ?",
        args: [NEXT_BADGE_NUMBER_KEY],
      });
      let counter = stateRows[0] ? parseInt(stateRows[0].value, 10) : 0;
      for (const row of unnumbered) {
        counter += 1;
        const badge = String(counter).padStart(3, "0");
        await client.execute({
          sql: "UPDATE members SET badge_number = ? WHERE discord_id = ?",
          args: [badge, row.discord_id],
        });
      }
      await client.execute({
        sql: `INSERT INTO bot_state (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [NEXT_BADGE_NUMBER_KEY, String(counter)],
      });
      console.log(`[db] เติมเลขนำหน้าให้สมาชิกเก่าที่ยังไม่มีเลขอัตโนมัติ ${unnumbered.length} คน`);
    }
  } catch (err) {
    console.error("[db] เติมเลขนำหน้าให้สมาชิกเก่าไม่สำเร็จ:", err.message);
  }

  console.log(
    TURSO_URL
      ? "[db] เชื่อมต่อ Turso (คลาวด์) เรียบร้อย — ข้อมูลจะไม่หายตอน deploy/restart"
      : "[db] ใช้ไฟล์ SQLite ในเครื่อง (local) — ตั้ง TURSO_DATABASE_URL ถ้าต้องการเก็บถาวรบน Render"
  );
})();

// ---------- แปลงชื่อคอลัมน์ snake_case (ในฐานข้อมูล) <-> camelCase (ที่ไฟล์คำสั่งใช้อยู่เดิม) ----------

function rowToMember(row) {
  if (!row) return null;
  return {
    discordId: row.discord_id,
    discordName: row.discord_name,
    gameName: row.game_name,
    department: row.department,
    position: row.position,
    badgeNumber: row.badge_number,
    registeredAt: row.registered_at,
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
  await client.execute({
    sql: `INSERT INTO members (discord_id, discord_name, game_name, department, position, badge_number, registered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.discordId,
      data.discordName,
      data.gameName,
      data.department ?? null,
      data.position,
      data.badgeNumber ?? null,
      data.registeredAt,
    ],
  });
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

async function updateMemberBadgeNumber(discordId, badgeNumber) {
  await ready;
  const result = await client.execute({
    sql: "UPDATE members SET badge_number = ? WHERE discord_id = ?",
    args: [badgeNumber, discordId],
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

async function setCheckOut(rowNumber, checkOutIso, hours) {
  await ready;
  await client.execute({
    sql: "UPDATE duty_log SET check_out = ?, hours = ?, status = 'ออกเวร' WHERE id = ?",
    args: [checkOutIso, hours, rowNumber],
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

// ---------- Export (ใช้โดยคำสั่ง /ส่งออกข้อมูล แทนการเปิดดู Google Sheets) ----------

function toCsv(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(",");
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(","));
  return [header, ...lines].join("\n");
}

async function exportAllCsv() {
  await ready;
  const [membersRes, dutyLogRes, summaryRes] = await Promise.all([
    client.execute("SELECT * FROM members"),
    client.execute("SELECT * FROM duty_log"),
    client.execute("SELECT * FROM summary"),
  ]);

  return {
    members: toCsv(membersRes.rows, [
      "discord_id",
      "discord_name",
      "game_name",
      "department",
      "position",
      "registered_at",
    ]),
    dutyLog: toCsv(dutyLogRes.rows, [
      "id",
      "discord_id",
      "name",
      "date",
      "check_in",
      "check_out",
      "hours",
      "status",
    ]),
    summary: toCsv(summaryRes.rows, [
      "discord_id",
      "name",
      "hours_today",
      "hours_week",
      "hours_month",
      "duty_count",
      "updated_at",
    ]),
  };
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

// ---------- เลขนำหน้า/เลขประจำตัวสมาชิก (ออกให้อัตโนมัติ เรียงตามลำดับ ไม่ซ้ำกัน) ----------

/**
 * ออกเลขนำหน้าตัวถัดไปแบบเรียงลำดับ (001, 002, 003, ...) โดยใช้ตัวนับที่เก็บใน bot_state
 * ตัวนับจะเดินหน้าเรื่อยๆ เท่านั้น (ไม่ถอยหลัง/ไม่นำเลขเดิมที่ถูกลบสมาชิกไปแล้วกลับมาใช้ซ้ำ)
 * เพื่อการันตีว่าเลขนำหน้าจะไม่ซ้ำกันแม้จะมีการลบสมาชิกออกไปก่อนหน้านี้
 */
async function getNextBadgeNumber() {
  await ready;
  const current = await getState(NEXT_BADGE_NUMBER_KEY);
  const next = current ? parseInt(current, 10) + 1 : 1;
  await setState(NEXT_BADGE_NUMBER_KEY, String(next));
  return String(next).padStart(3, "0");
}

/** หาสมาชิกที่ถือเลขนำหน้านี้อยู่ (ใช้เช็คกันชนตอนแอดมินแก้ไขเลขนำหน้าด้วยตนเอง) */
async function findMemberByBadgeNumber(badgeNumber) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM members WHERE badge_number = ?",
    args: [badgeNumber],
  });
  return rowToMember(rows[0]);
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
    totalHours: Math.round((r.total_hours || 0) * 100) / 100,
    memberCount: r.member_count,
  }));
}

// ---------- ระบบลงทะเบียนป้ายทะเบียนรถ ----------

function rowToPlate(row) {
  if (!row) return null;
  return {
    id: row.id,
    plateNumber: row.plate_number,
    ownerName: row.owner_name,
    registeredBy: row.registered_by,
    registeredByName: row.registered_by_name,
    createdAt: row.created_at,
  };
}

async function findPlateByNumber(plateNumber) {
  await ready;
  const { rows } = await client.execute({
    sql: "SELECT * FROM vehicle_plates WHERE plate_number = ?",
    args: [plateNumber],
  });
  return rowToPlate(rows[0]);
}

async function getAllPlates() {
  await ready;
  const { rows } = await client.execute("SELECT * FROM vehicle_plates ORDER BY plate_number ASC");
  return rows.map(rowToPlate);
}

/** ลงทะเบียนป้ายทะเบียนใหม่ คืนค่า null ถ้าเลขทะเบียนนี้มีอยู่แล้ว (กันซ้ำ) */
async function addPlate(entry) {
  await ready;
  const existing = await findPlateByNumber(entry.plateNumber);
  if (existing) return null;

  await client.execute({
    sql: `INSERT INTO vehicle_plates (plate_number, owner_name, registered_by, registered_by_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [entry.plateNumber, entry.ownerName, entry.registeredBy, entry.registeredByName, entry.createdAt],
  });
  return findPlateByNumber(entry.plateNumber);
}

async function removePlate(plateNumber) {
  await ready;
  const result = await client.execute({
    sql: "DELETE FROM vehicle_plates WHERE plate_number = ?",
    args: [plateNumber],
  });
  return Number(result.rowsAffected) > 0;
}

async function getPlatePanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM plate_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setPlatePanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO plate_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
}

async function getPlateListPanel() {
  await ready;
  const { rows } = await client.execute("SELECT channel_id, message_id FROM plate_list_panel WHERE id = 1");
  if (!rows[0]) return null;
  return { channelId: rows[0].channel_id, messageId: rows[0].message_id };
}

async function setPlateListPanel(channelId, messageId) {
  await ready;
  await client.execute({
    sql: `INSERT INTO plate_list_panel (id, channel_id, message_id) VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id`,
    args: [channelId, messageId],
  });
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
    sql: `INSERT INTO applications (discord_id, discord_name, department, game_name, age, phone, examiner_name, steam_link, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'รอตรวจสอบ', ?)`,
    args: [
      entry.discordId,
      entry.discordName,
      entry.department,
      entry.gameName,
      entry.age,
      entry.phone,
      entry.examinerName,
      entry.steamLink,
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

module.exports = {
  findMember,
  addMember,
  getAllMembers,
  updateMemberPosition,
  updateMemberBadgeNumber,
  removeMember,
  getDutyLogs,
  findOpenDuty,
  getAllOpenDuty,
  addCheckIn,
  setCheckOut,
  clearDutyStatus,
  clearClosedDutyLogs,
  editDutyTime,
  addManualAdjustment,
  writeSummaryRow,
  exportAllCsv,
  getPanelMessage,
  setPanelMessage,
  getApplicationPanel,
  setApplicationPanel,
  getRosterPanel,
  setRosterPanel,
  getState,
  setState,
  getNextBadgeNumber,
  findMemberByBadgeNumber,
  saveWeeklyHistory,
  getWeeklyHistory,
  listWeeklyHistoryWeeks,
  findPlateByNumber,
  getAllPlates,
  addPlate,
  removePlate,
  getPlatePanel,
  setPlatePanel,
  getPlateListPanel,
  setPlateListPanel,
  findPendingApplication,
  addApplication,
  getApplication,
  setApplicationReviewMessage,
  decideApplication,
};
