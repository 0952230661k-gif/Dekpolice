const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("ประวัติสัปดาห์")
    .setDescription("[แอดมิน] ดูสรุปชั่วโมงเวรของสัปดาห์ก่อนหน้าที่บันทึกไว้")
    .addStringOption((opt) =>
      opt
        .setName("สัปดาห์")
        .setDescription('รหัสสัปดาห์ เช่น 2026-W30 (เว้นว่างไว้เพื่อดูรายการสัปดาห์ล่าสุด)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const weekKey = interaction.options.getString("สัปดาห์")?.trim();

    if (!weekKey) {
      const weeks = await db.listWeeklyHistoryWeeks(25);
      if (weeks.length === 0) {
        return interaction.editReply({
          embeds: [embeds.adminActionEmbed("📜 ประวัติสัปดาห์ก่อนหน้า", "ยังไม่มีประวัติที่บันทึกไว้")],
        });
      }
      const fields = weeks.map((w) => ({
        name: `${w.weekKey} • ${time.weekRangeThaiFromKey(w.weekKey)}`,
        value: `${time.formatDurationThai(w.totalHours)} รวม / ${w.memberCount} คน`,
        inline: true,
      }));
      return interaction.editReply({
        embeds: [
          embeds.adminActionEmbed(
            "📜 รายการสัปดาห์ที่มีประวัติ",
            'ใช้คำสั่ง /ประวัติสัปดาห์ สัปดาห์:<รหัส> เพื่อดูรายละเอียด เช่น /ประวัติสัปดาห์ สัปดาห์:2026-W30',
            fields
          ),
        ],
      });
    }

    if (!/^\d{4}-W\d{2}$/.test(weekKey)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("รูปแบบรหัสสัปดาห์ไม่ถูกต้อง ใช้รูปแบบ YYYY-Wxx เช่น 2026-W30")],
      });
    }

    const rows = await db.getWeeklyHistory(weekKey);
    if (rows.length === 0) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`ไม่พบข้อมูลของสัปดาห์ ${weekKey}`)],
      });
    }

    const fields = rows.slice(0, 25).map((r) => ({
      name: r.name,
      value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
      inline: true,
    }));

    await interaction.editReply({
      embeds: [
        embeds.adminActionEmbed(
          `📜 สรุปสัปดาห์ ${time.weekRangeThaiFromKey(weekKey)}`,
          `รวม ${rows.length} คนที่มีข้อมูลในสัปดาห์นี้`,
          fields
        ),
      ],
    });
  },
};
