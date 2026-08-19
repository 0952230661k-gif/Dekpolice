const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("คนเข้าเวร")
    .setDescription("[แอดมิน] แสดงรายชื่อที่ยังไม่ออกเวร"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const openList = await db.getAllOpenDuty();
    if (openList.length === 0) {
      return interaction.editReply({
        embeds: [embeds.adminActionEmbed("🟢 คนเข้าเวรตอนนี้", "ไม่มีใครกำลังเข้าเวรอยู่")],
      });
    }

    const fields = openList.map((r) => ({
      name: r.name,
      value: `เข้าเวรเมื่อ: ${time.displayDateTime(r.checkIn)}`,
    }));

    await interaction.editReply({
      embeds: [
        embeds.adminActionEmbed(
          "🟢 คนเข้าเวรตอนนี้",
          `รวม ${openList.length} คน`,
          fields
        ),
      ],
    });
  },
};
