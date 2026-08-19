const db = require("./db");
const embeds = require("./embeds");

/**
 * โพสต์แผงเข้าเวรใหม่ในห้องที่ระบุ และบันทึกตำแหน่งข้อความไว้ใน DB
 * เพื่อให้บอทหาข้อความนี้เจอและอัปเดตสดได้ทุกครั้งที่มีคนเข้า/ออกเวร
 */
async function postPanel(channel) {
  const onDutyList = await db.getAllOpenDuty();
  const message = await channel.send({
    embeds: embeds.dutyPanelEmbeds(onDutyList),
    components: [embeds.dutyPanelRow()],
  });
  await db.setPanelMessage(channel.id, message.id);
  return message;
}

/**
 * อัปเดตแผงเข้าเวรที่ปักไว้ให้ตรงกับสถานะล่าสุดใน DB (เรียกทุกครั้งหลังเข้า/ออกเวร)
 * ถ้าหาข้อความเดิมไม่เจอ (ถูกลบไปแล้ว) จะข้ามไปเงียบๆ ไม่ error
 */
async function refreshPanel(client) {
  const panel = await db.getPanelMessage();
  if (!panel) return;

  try {
    const channel = await client.channels.fetch(panel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panel.messageId);
    if (!message) return;

    const onDutyList = await db.getAllOpenDuty();
    await message.edit({
      embeds: embeds.dutyPanelEmbeds(onDutyList),
      components: [embeds.dutyPanelRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงเข้าเวรได้:", err.message);
  }
}

module.exports = { postPanel, refreshPanel };
