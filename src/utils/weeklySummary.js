const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const config = require("../../config.json");
const { sendLog } = require("./permissions");

/**
 * สรุปชั่วโมงเวรของสัปดาห์นี้ — ใช้ร่วมกันทั้งปุ่ม "สรุปสัปดาห์นี้" ในแผงแอดมิน และคำสั่ง /สรุปสัปดาห์
 *
 * ตัวสรุปจะถูกส่งเข้า "ห้อง log สรุปสัปดาห์" ที่ตั้งไว้ใน config.json (logChannels["สรุปสัปดาห์"]) เท่านั้น
 * ไม่โพสต์ลงห้องที่แอดมินกด — แอดมินจะเห็นแค่ข้อความยืนยันแบบส่วนตัว (ephemeral) คนเดียว
 *
 * ต้องเรียก interaction.deferReply({ flags: MessageFlags.Ephemeral }) มาก่อน
 */
async function run(interaction) {
  const allLogs = await db.getDutyLogs();
  const byMember = {};
  for (const log of allLogs) {
    if (!byMember[log.discordId]) byMember[log.discordId] = [];
    byMember[log.discordId].push(log);
  }

  const rows = [];
  for (const [discordId, logs] of Object.entries(byMember)) {
    const summary = time.summarizeLogs(logs);
    if (summary.hoursWeek === 0 && summary.dutyCount === 0) continue;
    const name = logs[0]?.name || discordId;

    await db.writeSummaryRow({
      discordId,
      name,
      hoursToday: summary.hoursToday,
      hoursWeek: summary.hoursWeek,
      hoursMonth: summary.hoursMonth,
      dutyCount: summary.dutyCount,
      updatedAt: time.nowIso(),
    });

    rows.push({ name, ...summary });
  }

  const rangeText = time.weekRangeThai();
  const title = `📊 สรุปสัปดาห์นี้ (${rangeText})`;

  if (rows.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed(title, "ยังไม่มีข้อมูลการเข้าเวรในสัปดาห์นี้ (ไม่ได้ส่งเข้าห้องสรุป)")],
    });
  }

  rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  const embed = embeds.adminActionEmbed(
    title,
    `อัปเดตข้อมูลลงฐานข้อมูล Summary แล้ว (${rows.length} คน) — บอทจะตัดรอบ/เคลียร์ให้เองตอน 23:59 น. วันอาทิตย์ (หรือสั่งเคลียร์ฐานข้อมูลรายสัปดาห์เองก่อนก็ได้)`,
    fields
  );

  const sent = await sendLog(interaction.client, "สรุปสัปดาห์", embed);
  const logChannelId = config.logChannels?.["สรุปสัปดาห์"];

  // ตอบแอดมินแบบส่วนตัว (เห็นคนเดียว ไม่โผล่ในห้องแผงควบคุม)
  if (sent) {
    return interaction.editReply({
      embeds: [embeds.successEmbed(`ส่งสรุปสัปดาห์นี้ (${rangeText}) ไปที่ห้อง <#${logChannelId}> เรียบร้อยแล้ว (${rows.length} คน)`)],
    });
  }
  return interaction.editReply({
    embeds: [embeds.errorEmbed('ส่งสรุปไม่สำเร็จ — ยังไม่ได้ตั้งห้อง logChannels["สรุปสัปดาห์"] ใน config.json หรือบอทไม่มีสิทธิ์ส่งข้อความในห้องนั้น')],
  });
}

module.exports = { run };
