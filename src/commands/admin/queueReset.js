const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue-reset")
    .setDescription("[แอดมิน] รีเซ็ตคิวแพทย์ทั้งหมด (ล้างคิว/สถานะทุกคน)"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await db.clearQueueMembers();
    await queue.refreshQueuePanel(interaction.client);

    await interaction.editReply({ embeds: [embeds.successEmbed("รีเซ็ตคิวแพทย์ทั้งหมดเรียบร้อยแล้ว")] });

    await sendLog(
      interaction.client,
      "คิว",
      embeds.adminActionEmbed("🧹 รีเซ็ตคิวแพทย์", `แอดมิน ${interaction.user.tag} รีเซ็ตคิวแพทย์ทั้งหมด`)
    );
  },
};
