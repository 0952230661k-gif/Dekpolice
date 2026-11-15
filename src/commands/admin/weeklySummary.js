const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const weeklySummary = require("../../utils/weeklySummary");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("สรุปสัปดาห์")
    .setDescription("[แอดมิน] สร้างสรุปชั่วโมงเวรทั้งหมดของสัปดาห์นี้"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();
    await weeklySummary.run(interaction);
  },
};
