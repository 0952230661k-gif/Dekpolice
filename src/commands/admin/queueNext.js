const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue-next")
    .setDescription("[แอดมิน] เรียกคนหัวคิวให้รับเคสทันที"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await queue.forceNextCase(interaction.client);
    if (!result.ok) {
      return interaction.editReply({ embeds: [embeds.errorEmbed(result.reason)] });
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(`เรียก <@${result.discordId}> (${result.name}) ให้รับเคสแล้ว`)],
    });

    await sendLog(
      interaction.client,
      "คิว",
      embeds.adminActionEmbed("📣 เรียกคิวถัดไป", `แอดมิน ${interaction.user.tag} เรียก <@${result.discordId}> (${result.name}) ให้รับเคส`)
    );
  },
};
