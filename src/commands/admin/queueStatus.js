const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder().setName("queue-status").setDescription("[แอดมิน] ดูสถานะคิวแพทย์ทั้งหมด"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const groups = await queue.buildQueueGroups();
    await interaction.editReply({ embeds: [embeds.queueEmbed(groups)] });
  },
};
