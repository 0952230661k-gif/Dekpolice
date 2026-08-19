const db = require("./db");
const embeds = require("./embeds");
const config = require("../../config.json");

/**
 * โพสต์แผงสมัครเข้าหน่วยงานใหม่ในห้องที่ระบุ และบันทึกตำแหน่งข้อความไว้ใน DB
 * เป็นข้อความปักหมุดค้างไว้ถาวร ใครก็กดปุ่มสมัครได้ตลอดเวลา ไม่ต้องพิมพ์คำสั่ง /ใบสมัคร
 */
async function postApplicationPanel(channel) {
  const message = await channel.send({
    embeds: [embeds.applicationMenuEmbed(config.departments)],
    components: [embeds.applicationMenuRow(config.departments)],
  });
  await db.setApplicationPanel(channel.id, message.id);
  return message;
}

/**
 * อัปเดตแผงสมัครที่ปักไว้ให้ตรงกับ config ล่าสุด (เผื่อแก้ departments ใน config.json)
 * เรียกได้ผ่านคำสั่งแอดมิน ถ้าหาข้อความเดิมไม่เจอ (ถูกลบไปแล้ว) จะข้ามไปเงียบๆ ไม่ error
 */
async function refreshApplicationPanel(client) {
  const panel = await db.getApplicationPanel();
  if (!panel) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    await message.edit({
      embeds: [embeds.applicationMenuEmbed(config.departments)],
      components: [embeds.applicationMenuRow(config.departments)],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงสมัครได้:", err.message);
  }
}

module.exports = { postApplicationPanel, refreshApplicationPanel };
