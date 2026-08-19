const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

/**
 * Embed อธิบายแผงควบคุมแอดมิน
 * แผงนี้ตั้งใจให้โพสต์ในห้องที่จำกัดสิทธิ์การมองเห็นไว้เฉพาะแอดมินอยู่แล้ว (ตั้งค่าที่ตัวห้องใน Discord)
 * ปุ่มต่างๆ ในแผงนี้จึงไม่เช็คยศแอดมินซ้ำ — ใครก็ตามที่มองเห็น/กดปุ่มในห้องนี้ได้ ถือว่าใช้ฟังก์ชันแอดมินได้ทั้งหมด
 */
function adminPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle("🛠️ แผงควบคุมแอดมิน")
    .setDescription(
      "ห้องนี้จำกัดเฉพาะแอดมิน — กดปุ่มด้านล่างแทนการพิมพ์คำสั่ง /\n\n" +
        "**ข้อมูล:** 📋 คนเข้าเวรตอนนี้ / 📊 สรุปสัปดาห์นี้ / 📁 ส่งออก CSV\n" +
        "**จัดการชั่วโมง/เวลา:** ➕ เพิ่ม / ➖ ลด / ✏️ แก้เวลา / 🧹 ล้างสถานะเวร\n" +
        "**จัดการสมาชิก:** 🆕 เพิ่มสมาชิก / 🎖️ แก้ไขตำแหน่ง / 🗑️ ลบสมาชิก\n" +
        "**ระบบรายสัปดาห์:** 🧹 เคลียร์ฐานข้อมูลรายสัปดาห์ (สั่งเอง ไม่มีระบบอัตโนมัติ) / 📜 ประวัติสัปดาห์ก่อนหน้า"
    )
    .setFooter({ text: "MEDIC DUTY SYSTEM • Admin Panel" })
    .setTimestamp();
}

function adminPanelRows() {
  const rowInfo = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ap_onduty").setLabel("คนเข้าเวรตอนนี้").setEmoji("📋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_summary").setLabel("สรุปสัปดาห์นี้").setEmoji("📊").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ap_export").setLabel("ส่งออกข้อมูล CSV").setEmoji("📁").setStyle(ButtonStyle.Primary)
  );

  const rowHours = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ap_addhours").setLabel("เพิ่มชั่วโมง").setEmoji("➕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ap_subhours").setLabel("ลดชั่วโมง").setEmoji("➖").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ap_edittime").setLabel("แก้เวลา").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ap_clearduty").setLabel("ล้างสถานะเวร").setEmoji("🧹").setStyle(ButtonStyle.Secondary)
  );

  const rowMembers = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ap_register").setLabel("เพิ่มสมาชิก").setEmoji("🆕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ap_setposition").setLabel("แก้ไขตำแหน่ง").setEmoji("🎖️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ap_removemember").setLabel("ลบสมาชิก").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
  );

  const rowWeekly = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ap_runweekly").setLabel("เคลียร์ฐานข้อมูลรายสัปดาห์").setEmoji("🧹").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ap_weeklyhistory").setLabel("ประวัติสัปดาห์ก่อนหน้า").setEmoji("📜").setStyle(ButtonStyle.Secondary)
  );

  return [rowInfo, rowHours, rowMembers, rowWeekly];
}

module.exports = { adminPanelEmbed, adminPanelRows };
