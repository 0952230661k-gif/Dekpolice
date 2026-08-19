const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const time = require("../../utils/time");
const weeklyReset = require("../../utils/weeklyReset");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("เคลียร์ฐานข้อมูลรายสัปดาห์")
    .setDescription("[แอดมิน] สรุปเวรที่ค้างอยู่ บันทึกประวัติ แล้วลบข้อมูลที่ปิดแล้วจาก duty_log จริง")
    .addBooleanOption((opt) =>
      opt
        .setName("ยืนยัน")
        .setDescription("ระบุ true เพื่อยืนยัน คำสั่งนี้จะลบข้อมูลเวรที่ปิดรายการแล้วออกจากฐานข้อมูลจริง")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const confirmed = interaction.options.getBoolean("ยืนยัน");
    if (!confirmed) {
      return interaction.reply({
        embeds: [
          embeds.errorEmbed(
            "ยกเลิกแล้ว — ยังไม่ได้เคลียร์ฐานข้อมูล (ต้องระบุ ยืนยัน:true เพราะคำสั่งนี้จะลบข้อมูลเวรที่ปิดรายการแล้วออกจากระบบจริง)"
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { weekKey, rows, embed, clearedCount } = await weeklyReset.runNow(interaction.client);

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(
          `สั่งเคลียร์ฐานข้อมูลรายสัปดาห์ (${time.weekRangeThaiFromKey(weekKey)}) เรียบร้อยแล้ว ` +
            `(${rows.length} คนมีข้อมูลสะสม, ลบ ${clearedCount} แถวออกจากระบบ) — บันทึกลงประวัติแล้ว`
        ),
        embed,
      ],
    });
  },
};
