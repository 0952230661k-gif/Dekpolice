const db = require("./db");
const embeds = require("./embeds");
const time = require("./time");

/** ข้อมูลที่แผงต้องใช้: คนเข้าเวร, คน AFK, จำนวนคนที่ออกเวรแล้ววันนี้ */
async function panelState() {
  const onDutyList = await db.getAllOpenDuty();
  const afkIds = await db.getAfkIds();
  const logs = await db.getDutyLogs();
  const today = time.todayStr();
  const offToday = new Set(
    logs
      .filter((l) => l.status === "ออกเวร" && l.checkOut && l.checkOut !== "-" && time.isSameDay(l.checkOut, today))
      .map((l) => l.discordId)
  ).size;
  return { onDutyList, afkIds, offToday };
}

/**
 * โพสต์แผงเข้าเวรใหม่ในห้องที่ระบุ และบันทึกตำแหน่งข้อความไว้ใน DB
 * เพื่อให้บอทหาข้อความนี้เจอและอัปเดตสดได้ทุกครั้งที่มีคนเข้า/ออกเวร
 */
async function postPanel(channel) {
  const { onDutyList, afkIds, offToday } = await panelState();
  const message = await channel.send({
    embeds: embeds.dutyPanelEmbeds(onDutyList, afkIds, offToday),
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

    const { onDutyList, afkIds, offToday } = await panelState();
    await message.edit({
      embeds: embeds.dutyPanelEmbeds(onDutyList, afkIds, offToday),
      components: [embeds.dutyPanelRow()],
    });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตแผงเข้าเวรได้:", err.message);
  }
}

module.exports = { postPanel, refreshPanel };
