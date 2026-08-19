const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("[แอดมิน] เปิดระบบคิวแพทย์ในห้องนี้ (หรือห้องที่ระบุ)")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผงคิวแพทย์ (ค่าเริ่มต้น: ห้องนี้)")
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
    await queue.postQueuePanel(targetChannel);

    await interaction.editReply({
      embeds: [embeds.successEmbed(`เปิดระบบคิวแพทย์ในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว`)],
    });
  },
};
