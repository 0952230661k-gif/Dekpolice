const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { sendLog } = require("../utils/permissions");
const dutyActions = require("../utils/dutyActions");
const panel = require("../utils/panel");
const embeds = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder().setName("เข้าเวร").setDescription("เริ่มเข้าเวร"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await dutyActions.checkIn(interaction.user);

    if (result.ok) {
      await interaction.editReply({ embeds: [embeds.successEmbed("เข้าเวรสำเร็จ")] });
      await sendLog(interaction.client, "เข้าเวร", result.logEmbed);
      await panel.refreshPanel(interaction.client);
    } else {
      await interaction.editReply({ embeds: [result.embed] });
    }
  },
};
