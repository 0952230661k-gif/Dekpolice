const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue-add")
    .setDescription("[แอดมิน] เพิ่มคนเข้าคิวแพทย์ด้วยตนเอง")
    .addUserOption((opt) => opt.setName("สมาชิก").setDescription("ผู้ที่ต้องการเพิ่มเข้าคิว").setRequired(true)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("สมาชิก");
    const existingQueue = await db.getQueueMember(target.id);
    if (existingQueue) {
      return interaction.editReply({ embeds: [embeds.errorEmbed("คนนี้อยู่ในคิวแพทย์อยู่แล้ว")] });
    }

    const member = await db.findMember(target.id);
    const name = member?.gameName || target.username;

    await db.addQueueMember(target.id, name, time.nowIso());
    await queue.refreshQueuePanel(interaction.client);

    await interaction.editReply({ embeds: [embeds.successEmbed(`เพิ่ม ${name} เข้าคิวแพทย์ (ท้ายคิว) เรียบร้อยแล้ว`)] });

    await sendLog(
      interaction.client,
      "คิว",
      embeds.adminActionEmbed("➕ เพิ่มเข้าคิวแพทย์", `แอดมิน ${interaction.user.tag} เพิ่ม <@${target.id}> (${name}) เข้าคิวแพทย์`)
    );
  },
};
