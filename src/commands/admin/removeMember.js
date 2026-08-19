const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("ลบสมาชิก")
    .setDescription("[แอดมิน] ลบสมาชิกออกจากรายชื่อในระบบ")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการลบ (ตัวเลขล้วน)")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discordId = interaction.options.getString("ไอดีดิสคอร์ด").trim();

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    const existing = await db.findMember(discordId);
    if (!existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ")],
      });
    }

    await db.removeMember(discordId);
    await roster.refreshRoster(interaction.client);

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(`ลบสมาชิก ${existing.gameName} (${existing.discordName}) ออกจากระบบเรียบร้อยแล้ว`),
      ],
    });

    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.adminActionEmbed("🗑️ ลบสมาชิก", `แอดมิน ${interaction.user.tag} ลบสมาชิกออกจากระบบ`, [
        { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
        { name: "ตำแหน่งเดิม", value: existing.position || "-", inline: true },
      ])
    );
  },
};
