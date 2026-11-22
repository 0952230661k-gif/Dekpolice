const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const story = require("../../utils/story");
const { isAdmin } = require("../../utils/permissions");
const config = require("../../../config.json");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แผงสตอรี่อุ้ม")
    .setDescription("โพสต์แผงเวลาสตอรี่อุ้ม (เข้าด้วย OTP ที่แอดมินเปิด) (แอดมินเท่านั้น)")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผง (ค่าเริ่มต้น: storyChannelId ใน config ถ้ามี ไม่งั้นห้องนี้)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let target = interaction.options.getChannel("ห้อง");
    if (!target && story.validId(config.storyChannelId)) {
      target = await interaction.client.channels.fetch(config.storyChannelId).catch(() => null);
    }
    target = target || interaction.channel;

    try {
      await story.postPanel(target);
    } catch (err) {
      console.error("โพสต์แผงสตอรี่อุ้มไม่สำเร็จ:", err);
      return interaction.editReply({ embeds: [embeds.errorEmbed(`โพสต์แผงในห้อง <#${target.id}> ไม่สำเร็จ: ${err.message}`)] });
    }
    await interaction.editReply({ embeds: [embeds.successEmbed(`โพสต์แผงเวลาสตอรี่อุ้มในห้อง <#${target.id}> เรียบร้อยแล้ว`)] });
  },
};
