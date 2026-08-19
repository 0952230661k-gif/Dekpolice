const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const applicationPanel = require("../../utils/applicationPanel");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("แผงสมัคร")
    .setDescription("โพสต์แผงสมัครเข้าหน่วยงานแบบปุ่ม ค้างไว้ถาวรในห้อง (แอดมินเท่านั้น)")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผงสมัคร (ค่าเริ่มต้น: ห้องนี้)")
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
    await applicationPanel.postApplicationPanel(targetChannel);

    await interaction.editReply({
      embeds: [embeds.successEmbed(`โพสต์แผงสมัครในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว`)],
    });
  },
};
