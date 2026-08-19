const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue-remove")
    .setDescription("[แอดมิน] นำคนออกจากคิวแพทย์")
    .addUserOption((opt) => opt.setName("สมาชิก").setDescription("ผู้ที่ต้องการนำออกจากคิว").setRequired(true)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("สมาชิก");
    const existing = await db.getQueueMember(target.id);
    if (!existing) {
      return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบคนนี้ในคิวแพทย์")] });
    }

    await db.removeQueueMember(target.id);
    await queue.refreshQueuePanel(interaction.client);

    await interaction.editReply({
      embeds: [embeds.successEmbed(`นำ ${existing.name} ออกจากคิวแพทย์เรียบร้อยแล้ว`)],
    });

    await sendLog(
      interaction.client,
      "คิว",
      embeds.adminActionEmbed("➖ นำออกจากคิวแพทย์", `แอดมิน ${interaction.user.tag} นำ <@${target.id}> (${existing.name}) ออกจากคิวแพทย์`)
    );
  },
};
