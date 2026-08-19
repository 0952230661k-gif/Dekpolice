const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const platePanel = require("../../utils/platePanel");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("ลบทะเบียน")
    .setDescription("[แอดมิน] ลบป้ายทะเบียนรถออกจากระบบ")
    .addStringOption((opt) => opt.setName("เลขทะเบียน").setDescription("เลขทะเบียนที่ต้องการลบ").setRequired(true)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const plateNumber = interaction.options.getString("เลขทะเบียน").trim();
    const existing = await db.findPlateByNumber(plateNumber);
    if (!existing) {
      return interaction.editReply({ embeds: [embeds.errorEmbed(`ไม่พบเลขทะเบียน \`${plateNumber}\` ในระบบ`)] });
    }

    await db.removePlate(plateNumber);
    await platePanel.refreshPlateList(interaction.client);

    await interaction.editReply({
      embeds: [embeds.successEmbed(`ลบป้ายทะเบียน \`${plateNumber}\` (เจ้าของ/ผู้ขับ: ${existing.ownerName}) ออกจากระบบเรียบร้อยแล้ว`)],
    });

    await sendLog(
      interaction.client,
      "ทะเบียน",
      embeds.adminActionEmbed("🗑️ ลบป้ายทะเบียน", `แอดมิน ${interaction.user.tag} ลบป้ายทะเบียนออกจากระบบ`, [
        { name: "เลขทะเบียน", value: plateNumber, inline: true },
        { name: "เจ้าของ/ผู้ขับ", value: existing.ownerName, inline: true },
      ])
    );
  },
};
