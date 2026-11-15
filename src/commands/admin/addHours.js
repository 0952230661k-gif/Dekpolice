const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("เพิ่มชั่วโมง")
    .setDescription("[แอดมิน] เพิ่มชั่วโมงเวรให้สมาชิกด้วยตนเอง")
    .addUserOption((opt) => opt.setName("สมาชิก").setDescription("สมาชิก").setRequired(true))
    .addNumberOption((opt) =>
      opt.setName("ชั่วโมง").setDescription("จำนวนชั่วโมงที่ต้องการเพิ่ม").setRequired(true)
    )
    .addStringOption((opt) => opt.setName("เหตุผล").setDescription("เหตุผลในการเพิ่ม").setRequired(false)),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("สมาชิก");
    const amount = interaction.options.getNumber("ชั่วโมง");
    const reason = interaction.options.getString("เหตุผล");

    if (amount <= 0) {
      return interaction.editReply({ embeds: [embeds.errorEmbed("จำนวนชั่วโมงต้องมากกว่า 0")] });
    }

    const member = await db.findMember(target.id);
    if (!member) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`${target.tag} ยังไม่ได้สมัครสมาชิกในระบบ`)],
      });
    }

    await db.addManualAdjustment(target.id, member.gameName, amount, reason, time.todayStr());

    const embed = embeds.adminActionEmbed(
      "➕ เพิ่มชั่วโมงเวร",
      `เพิ่ม ${amount} ชั่วโมงให้ ${target.tag}`,
      [
        { name: "เหตุผล", value: reason || "-", inline: true },
        { name: "ดำเนินการโดย", value: interaction.user.tag, inline: true },
      ]
    );

    await interaction.editReply({ embeds: [embed] });
    await sendLog(interaction.client, "แอดมิน", embed);
  },
};
