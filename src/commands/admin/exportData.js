const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("ส่งออกข้อมูล")
    .setDescription("[แอดมิน] ส่งออกข้อมูลสมาชิก/เวร/สรุปทั้งหมดเป็นไฟล์ CSV"),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { members, dutyLog, summary } = await db.exportAllCsv();

    const files = [
      new AttachmentBuilder(Buffer.from(members, "utf-8"), { name: "members.csv" }),
      new AttachmentBuilder(Buffer.from(dutyLog, "utf-8"), { name: "duty_log.csv" }),
      new AttachmentBuilder(Buffer.from(summary, "utf-8"), { name: "summary.csv" }),
    ];

    await interaction.editReply({
      embeds: [embeds.successEmbed("ส่งออกข้อมูลทั้ง 3 ตารางเรียบร้อยแล้ว (แนบไฟล์ด้านล่าง)")],
      files,
    });
  },
};
