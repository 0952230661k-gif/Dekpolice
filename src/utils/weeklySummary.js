const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const config = require("../../config.json");
const { sendLog } = require("./permissions");

/**
 * สรุปชั่วโมงเวรของสัปดาห์นี้ — ใช้ร่วมกันทั้งปุ่ม "สรุปสัปดาห์นี้" ในแผงแอดมิน และคำสั่ง /สรุปสัปดาห์
 *
 * ผลลัพธ์ส่งไป 2 ที่:
 *  1) ตอบกลับในห้องที่แอดมินกดมา (เหมือนเดิม)
 *  2) ห้อง log "สรุปสัปดาห์" ที่ตั้งไว้ใน config.json (logChannels["สรุปสัปดาห์"])
 *     — ถ้าแอดมินกดในห้องนั้นอยู่แล้วจะไม่ส่งซ้ำ
 *
 * ต้องเรียก interaction.deferReply() มาก่อน
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
      embeds: [embeds.adminActionEmbed(title, "ยังไม่มีข้อมูลการเข้าเวรในสัปดาห์นี้")],
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
    `อัปเดตข้อมูลลงฐานข้อมูล Summary แล้ว (${rows.length} คน) — ยอดสัปดาห์นี้จะไม่ถูกรีเซ็ตเองอัตโนมัติ ต้องสั่งเคลียร์ฐานข้อมูลรายสัปดาห์เองเมื่อจบรอบ`,
    fields
  );

  // 1) ตอบในห้องที่แอดมินกด (เหมือนเดิม)
  await interaction.editReply({ embeds: [embed] });

  // 2) ส่งเข้าห้อง log สรุปสัปดาห์ (ข้ามถ้าห้องที่กดคือห้องเดียวกัน กันข้อความซ้ำ)
  const logChannelId = config.logChannels?.["สรุปสัปดาห์"];
  if (interaction.channelId !== logChannelId) {
    await sendLog(interaction.client, "สรุปสัปดาห์", embed);
  }
}

module.exports = { run };
