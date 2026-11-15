const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ห้องรายชื่อ")
    .setDescription("[แอดมิน] โพสต์รายชื่อสมาชิกแบบสด อัปเดตอัตโนมัติเมื่อมีการเพิ่ม/เลื่อนตำแหน่ง")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์รายชื่อ (ค่าเริ่มต้น: ห้องนี้)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannel = interaction.options.getChannel("ห้อง") || interaction.channel;

    try {
      await roster.postRoster(targetChannel);
    } catch (err) {
      console.error("โพสต์ห้องรายชื่อไม่สำเร็จ:", err);
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`โพสต์รายชื่อไม่สำเร็จ: ${err.message || "ไม่ทราบสาเหตุ"}`)],
      });
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(`โพสต์รายชื่อในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว จะอัปเดตอัตโนมัติทุกครั้งที่มีการเพิ่ม/เลื่อนตำแหน่งสมาชิก`)],
    });
  },
};
