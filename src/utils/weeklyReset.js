const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const { sendLog } = require("./permissions");

/**
 * ระบบเคลียร์ฐานข้อมูลเวรรายสัปดาห์ — แบบแอดมิน "สั่งเอง" เท่านั้น ไม่มีระบบอัตโนมัติ
 *
 * (เดิมระบบนี้เช็คทุก 1 นาทีแล้วตัดสัปดาห์ให้อัตโนมัติตาม ISO week ปฏิทิน โดยไม่ลบข้อมูลเก่าออกจาก
 *  duty_log เลย — ตอนนี้เปลี่ยนใหม่ทั้งหมด: ไม่มีการเช็ค/รันอัตโนมัติอีกต่อไป แอดมินเป็นคนตัดสินใจเองว่า
 *  เมื่อไหร่ถือว่า "จบรอบ" แล้วสั่งเคลียร์ผ่านคำสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ หรือปุ่มในแผงแอดมิน)
 *
 * เมื่อแอดมินสั่งรัน (runNow) ระบบจะทำตามลำดับนี้:
 *   1) สรุปยอดชั่วโมงจากข้อมูลที่ "ค้างอยู่ในระบบตอนนี้" (คือข้อมูลตั้งแต่ครั้งที่แล้วที่เคลียร์ หรือทั้งหมด
 *      ถ้ายังไม่เคยเคลียร์เลย)
 *   2) บวกสะสมยอดนั้นเข้ากับประวัติของสัปดาห์ปัจจุบันในตาราง weekly_summary_history — ถ้าแอดมินสั่งเคลียร์
 *      หลายครั้งในสัปดาห์เดียวกัน ยอดจะถูกสะสมรวมกันไม่ถูกเขียนทับ จนกว่าจะขึ้นสัปดาห์ใหม่
 *   3) เขียนยอดสะสมล่าสุดของสัปดาห์นี้ลงตาราง summary (ไว้เปิดดูแบบ live)
 *   4) ลบแถวใน duty_log ที่ "ปิดรายการแล้ว" ออกจากฐานข้อมูลจริงๆ (ออกเวร / ล้างแล้ว (แอดมิน) / ปรับเพิ่ม /
 *      ปรับลด) — ไม่ลบแถวที่ยังเข้าเวรค้างอยู่ กันข้อมูลกะที่กำลังทำงานอยู่หาย
 *   5) โพสต์แจ้งสรุปในห้อง log (logChannels["สรุปสัปดาห์"] ใน config.json)
 *
 * หมายเหตุสำคัญ: /ชั่วโมง (ดูชั่วโมงของตัวเอง) คำนวณ hoursToday / hoursWeek / hoursMonth สดจาก
 * duty_log ตารางเดียวกันทั้งหมด ดังนั้นเมื่อสั่งเคลียร์ครั้งนี้ ยอด "วันนี้" และ "เดือนนี้" ของทุกคน
 * จะเริ่มนับใหม่ไปด้วย ไม่ใช่แค่ยอด "สัปดาห์นี้" — จึงควรสั่งเคลียร์ตอนจบรอบสัปดาห์จริงๆ เท่านั้น
 * (ยอดที่สรุปไปแล้วยังดูย้อนหลังได้เสมอผ่าน /ประวัติสัปดาห์)
 */

// ---------- สรุปยอดชั่วโมงจากข้อมูลที่ค้างอยู่ใน duty_log ตอนนี้ทั้งหมด (ยังไม่บันทึก/ลบอะไร) ----------
async function buildCurrentSummary() {
  const allLogs = await db.getDutyLogs();
  const byMember = {};
  for (const log of allLogs) {
    if (!byMember[log.discordId]) byMember[log.discordId] = [];
    byMember[log.discordId].push(log);
  }

  const rows = [];
  for (const [discordId, logs] of Object.entries(byMember)) {
    let hours = 0;
    let dutyCount = 0;
    for (const log of logs) {
      if (log.status === "ออกเวร" || log.status.startsWith("ปรับเพิ่ม") || log.status.startsWith("ปรับลด")) {
        hours += parseFloat(log.hours) || 0;
        if (log.status === "ออกเวร") dutyCount += 1;
      }
    }
    if (hours === 0 && dutyCount === 0) continue;
    const name = logs[0]?.name || discordId;
    rows.push({ discordId, name, hoursWeek: Math.round(hours * 100) / 100, dutyCount });
  }

  rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
  return rows;
}

function buildSummaryEmbed(weekKey, rows, clearedCount) {
  const rangeText = time.weekRangeThaiFromKey(weekKey);
  const description =
    rows.length === 0
      ? "ไม่มีข้อมูลการเข้าเวรที่ต้องสรุปในรอบนี้"
      : `สรุปชั่วโมงเวรสะสมของสัปดาห์ (${rangeText}) — สั่งเคลียร์ฐานข้อมูลด้วยตนเอง บันทึกลงประวัติแล้ว` +
        (clearedCount > 0 ? ` และลบข้อมูลที่ปิดรายการแล้ว ${clearedCount} รายการออกจากระบบเรียบร้อย` : "");

  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  return embeds.adminActionEmbed(`🧹 เคลียร์ฐานข้อมูลรายสัปดาห์ (${rangeText})`, description, fields);
}

/**
 * จุดเดียวที่ระบบนี้ทำงาน — แอดมินสั่งเอง ไม่มีการรันอัตโนมัติใดๆ ทั้งสิ้น
 * สรุปยอด + สะสมลงประวัติของสัปดาห์นี้ + อัปเดตตาราง summary + ลบข้อมูลที่ปิดรายการแล้วออกจาก duty_log จริง
 * เรียกซ้ำได้ (เช่นสั่งเคลียร์หลายรอบในสัปดาห์เดียวกัน) ยอดในประวัติจะสะสมรวมกันไปเรื่อยๆ
 */
async function runNow(client) {
  const weekKey = time.isoWeekKey(time.now());
  const updatedAt = time.nowIso();

  const batchRows = await buildCurrentSummary();
  await db.saveWeeklyHistory(weekKey, batchRows, updatedAt); // สะสมเข้ากับยอดสัปดาห์นี้ที่มีอยู่ (ถ้ามี)

  const accumulatedRows = await db.getWeeklyHistory(weekKey); // ยอดสะสมล่าสุดของสัปดาห์นี้ทั้งหมด

  for (const row of accumulatedRows) {
    await db.writeSummaryRow({
      discordId: row.discordId,
      name: row.name,
      hoursToday: 0,
      hoursWeek: row.hoursWeek,
      hoursMonth: 0,
      dutyCount: row.dutyCount,
      updatedAt,
    });
  }

  const clearedCount = await db.clearClosedDutyLogs();

  const embed = buildSummaryEmbed(weekKey, accumulatedRows, clearedCount);
  if (client) {
    await sendLog(client, "สรุปสัปดาห์", embed);
  }

  console.log(
    `[เคลียร์ฐานข้อมูลรายสัปดาห์] แอดมินสั่งรันด้วยตนเองสำเร็จ (สัปดาห์ ${weekKey}) — ลบ ${clearedCount} แถวออกจาก duty_log`
  );
  return { weekKey, rows: accumulatedRows, embed, clearedCount };
}

module.exports = { runNow, buildCurrentSummary };
