const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const dayjs = require("dayjs");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const queue = require("../../utils/queue");
const { isAdmin, sendLog } = require("../../utils/permissions");

const STATUS_CHOICES = [
  { name: "พร้อมรับเคส", value: "ready" },
  { name: "กำลังรับเคส", value: "on_case" },
  { name: "พัก", value: "break" },
  { name: "ชุบลูป", value: "loop" },
];

const STATUS_LABEL = { ready: "พร้อมรับเคส 🟢", on_case: "กำลังรับเคส 🚑", break: "พัก ☕", loop: "ชุบลูป 🔄" };

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("queue-set")
    .setDescription("[แอดมิน] กำหนดสถานะในคิวแพทย์ให้สมาชิก")
    .addUserOption((opt) => opt.setName("สมาชิก").setDescription("ผู้ที่ต้องการกำหนดสถานะ").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("สถานะ").setDescription("สถานะที่ต้องการกำหนด").setRequired(true).addChoices(...STATUS_CHOICES)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("นาทีพัก")
        .setDescription("จำนวนนาทีที่พัก (ใช้เมื่อกำหนดสถานะเป็นพัก, ค่าเริ่มต้น 30 นาที)")
        .setMinValue(1)
        .setMaxValue(480)
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

    const target = interaction.options.getUser("สมาชิก");
    const status = interaction.options.getString("สถานะ");
    const breakMinutes = interaction.options.getInteger("นาทีพัก") || 30;

    let qMember = await db.getQueueMember(target.id);
    if (!qMember) {
      const member = await db.findMember(target.id);
      const name = member?.gameName || target.username;
      qMember = await db.addQueueMember(target.id, name, time.nowIso());
    }

    const nowIso = time.nowIso();
    if (status === "ready") {
      await db.setQueueReady(target.id, nowIso);
    } else if (status === "on_case") {
      await db.setQueueOnCase(target.id, nowIso);
    } else if (status === "break") {
      const untilIso = dayjs(nowIso).add(breakMinutes, "minute").toISOString();
      await db.setQueueBreak(target.id, nowIso, untilIso, breakMinutes);
    } else if (status === "loop") {
      await db.setQueueLoop(target.id, nowIso);
    }

    await queue.refreshQueuePanel(interaction.client);

    await interaction.editReply({
      embeds: [embeds.successEmbed(`กำหนดสถานะของ ${qMember.name} เป็น ${STATUS_LABEL[status]} เรียบร้อยแล้ว`)],
    });

    await sendLog(
      interaction.client,
      "คิว",
      embeds.adminActionEmbed(
        "🛠️ กำหนดสถานะคิวแพทย์",
        `แอดมิน ${interaction.user.tag} กำหนดสถานะของ <@${target.id}> (${qMember.name}) เป็น ${STATUS_LABEL[status]}`
      )
    );
  },
};
