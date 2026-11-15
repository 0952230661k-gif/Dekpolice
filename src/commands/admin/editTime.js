const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const dayjs = require("dayjs");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const { isAdmin, sendLog } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แก้เวลา")
    .setDescription("[แอดมิน] แก้เวลาเข้า/ออกเวรของสมาชิก")
    .addUserOption((opt) => opt.setName("สมาชิก").setDescription("สมาชิก").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("วันที่").setDescription("วันที่ของรายการเวร (YYYY-MM-DD)").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("เวลาเข้า").setDescription("เวลาเข้าใหม่ (HH:mm)").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("เวลาออก").setDescription("เวลาออกใหม่ (HH:mm) ไม่ระบุได้ถ้ายังไม่ออกเวร").setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("สมาชิก");
    const dateStr = interaction.options.getString("วันที่");
    const checkInStr = interaction.options.getString("เวลาเข้า");
    const checkOutStr = interaction.options.getString("เวลาออก");

    if (!dayjs(dateStr, "YYYY-MM-DD", true).isValid()) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("รูปแบบวันที่ไม่ถูกต้อง ใช้รูปแบบ YYYY-MM-DD เช่น 2026-07-29")],
      });
    }

    const logs = await db.getDutyLogs(target.id);
    const matches = logs.filter((r) => r.date === dateStr);
    if (matches.length === 0) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`ไม่พบรายการเวรของ ${target.tag} ในวันที่ ${dateStr}`)],
      });
    }
    // ใช้แถวล่าสุดของวันนั้น
    const targetRow = matches[matches.length - 1];

    const newCheckIn = dayjs.tz(`${dateStr} ${checkInStr}`, "YYYY-MM-DD HH:mm", time.TZ).toISOString();
    let newCheckOut = null;
    let hours = targetRow.hours;

    if (checkOutStr) {
      let checkOutDate = dayjs.tz(`${dateStr} ${checkOutStr}`, "YYYY-MM-DD HH:mm", time.TZ);
      // ถ้าเวลาออกน้อยกว่าเวลาเข้า ให้ถือว่าข้ามไปวันถัดไป (เข้าเวรข้ามวัน)
      if (checkOutDate.isBefore(dayjs(newCheckIn))) {
        checkOutDate = checkOutDate.add(1, "day");
      }
      newCheckOut = checkOutDate.toISOString();
      hours = time.hoursBetween(newCheckIn, newCheckOut);
    }

    await db.editDutyTime(targetRow._rowNumber, newCheckIn, newCheckOut, hours);

    const embed = embeds.adminActionEmbed(
      "✏️ แก้ไขเวลาเวร",
      `แก้ไขรายการเวรของ ${target.tag} วันที่ ${dateStr}`,
      [
        { name: "เวลาเข้าใหม่", value: time.displayDateTime(newCheckIn), inline: true },
        {
          name: "เวลาออกใหม่",
          value: newCheckOut ? time.displayDateTime(newCheckOut) : "ไม่เปลี่ยนแปลง",
          inline: true,
        },
        { name: "ดำเนินการโดย", value: interaction.user.tag },
      ]
    );

    await interaction.editReply({ embeds: [embed] });
    await sendLog(interaction.client, "แอดมิน", embed);
  },
};
