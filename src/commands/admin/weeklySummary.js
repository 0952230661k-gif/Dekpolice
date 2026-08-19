const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("สรุปสัปดาห์")
    .setDescription("[แอดมิน] สร้างสรุปชั่วโมงเวรทั้งหมดของสัปดาห์นี้"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

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

    if (rows.length === 0) {
      return interaction.editReply({
        embeds: [embeds.adminActionEmbed("📊 สรุปสัปดาห์นี้", "ยังไม่มีข้อมูลการเข้าเวรในสัปดาห์นี้")],
      });
    }

    rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
    const fields = rows.slice(0, 25).map((r) => ({
      name: r.name,
      value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
      inline: true,
    }));

    const rangeText = time.weekRangeThai();

    await interaction.editReply({
      embeds: [
        embeds.adminActionEmbed(
          `📊 สรุปสัปดาห์นี้ (${rangeText})`,
          `อัปเดตข้อมูลลงฐานข้อมูล Summary แล้ว (${rows.length} คน) — ยอดสัปดาห์นี้จะไม่ถูกรีเซ็ตเองอัตโนมัติ ต้องสั่งเคลียร์ฐานข้อมูลรายสัปดาห์เองด้วยคำสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ เมื่อจบรอบ`,
          fields
        ),
      ],
    });
  },
};
