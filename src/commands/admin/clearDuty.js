const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const { isAdmin, sendLog } = require("../../utils/permissions");
const panel = require("../../utils/panel");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("ล้างเวร")
    .setDescription("[แอดมิน] ล้างสถานะเข้าเวรของสมาชิก")
    .addUserOption((opt) =>
      opt.setName("สมาชิก").setDescription("สมาชิกที่ต้องการล้างสถานะ").setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("สมาชิก");
    const cleared = await db.clearDutyStatus(target.id);

    if (!cleared) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`${target.tag} ไม่มีสถานะเข้าเวรค้างอยู่`)],
      });
    }

    const embed = embeds.adminActionEmbed(
      "🧹 ล้างสถานะเข้าเวร",
      `ล้างสถานะเข้าเวรของ ${target.tag} เรียบร้อย`,
      [{ name: "ดำเนินการโดย", value: interaction.user.tag }]
    );

    await interaction.editReply({ embeds: [embed] });
    await sendLog(interaction.client, "แอดมิน", embed);
    await panel.refreshPanel(interaction.client);
  },
};
