const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder().setName("ชั่วโมง").setDescription("ดูชั่วโมงเข้าเวรของตัวเอง"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await db.findMember(interaction.user.id);
    if (!member) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ")],
      });
    }

    const logs = await db.getDutyLogs(interaction.user.id);
    const summary = time.summarizeLogs(logs);

    await interaction.editReply({
      embeds: [embeds.hoursEmbed({ gameName: member.gameName, ...summary })],
    });
  },
};
