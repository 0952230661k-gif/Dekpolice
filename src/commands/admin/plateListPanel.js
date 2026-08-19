const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const platePanel = require("../../utils/platePanel");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("รายชื่อทะเบียน")
    .setDescription("[แอดมิน] โพสต์รายการป้ายทะเบียนที่ลงทะเบียนไว้แบบสด อัปเดตอัตโนมัติทุกครั้งที่มีการลงทะเบียนใหม่")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์รายการ (ค่าเริ่มต้น: ห้องนี้) — ควรเป็นห้องอัพเดทป้ายทะเบียนปัจจุบัน")
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
      await platePanel.postPlateList(targetChannel);
    } catch (err) {
      console.error("โพสต์รายการทะเบียนไม่สำเร็จ:", err);
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`โพสต์รายการไม่สำเร็จ: ${err.message || "ไม่ทราบสาเหตุ"}`)],
      });
    }

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(
          `โพสต์รายการป้ายทะเบียนในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว จะอัปเดตอัตโนมัติทุกครั้งที่มีการลงทะเบียนใหม่`
        ),
      ],
    });
  },
};
