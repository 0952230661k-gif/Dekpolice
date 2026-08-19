const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const embeds = require("../utils/embeds");
const config = require("../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ใบสมัคร")
    .setDescription("เปิดเมนูสมัครเข้าหน่วยงาน (เลือกหน่วยงาน + กรอกแบบฟอร์ม)"),

  async execute(interaction) {
    const existingMember = await db.findMember(interaction.user.id);
    if (existingMember) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คุณเป็นสมาชิกในระบบอยู่แล้ว ไม่จำเป็นต้องสมัครใหม่")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const pending = await db.findPendingApplication(interaction.user.id);
    if (pending) {
      return interaction.reply({
        embeds: [
          embeds.errorEmbed(
            `คุณมีใบสมัคร #${pending.id} (หน่วยงาน ${pending.department}) ที่ยังรอการตรวจสอบอยู่ กรุณารอผลก่อนสมัครใหม่`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      embeds: [embeds.applicationMenuEmbed(config.departments)],
      components: [embeds.applicationMenuRow(config.departments)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
