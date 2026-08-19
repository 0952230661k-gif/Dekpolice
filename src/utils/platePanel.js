const { PermissionsBitField } = require("discord.js");
const db = require("./db");
const embeds = require("./embeds");
const time = require("./time");

function assertCanSend(channel) {
  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (
    perms &&
    (!perms.has(PermissionsBitField.Flags.ViewChannel) ||
      !perms.has(PermissionsBitField.Flags.SendMessages) ||
      !perms.has(PermissionsBitField.Flags.EmbedLinks))
  ) {
    throw new Error(
      "บอทไม่มีสิทธิ์ในห้องนี้ กรุณาให้สิทธิ์ View Channel, Send Messages และ Embed Links แก่บอทในห้องนี้"
    );
  }
}

// ---------- ห้องส่งป้ายทะเบียน (ปุ่มลงทะเบียนป้ายทะเบียนใหม่แบบข้อความปักหมุด) ----------

async function postPlatePanel(channel) {
  assertCanSend(channel);
  const message = await channel.send({
    embeds: embeds.plateSubmitPanelEmbeds(),
    components: [embeds.plateSubmitRow()],
  });
  await db.setPlatePanel(channel.id, message.id);
  return message;
}

// ---------- ห้องอัพเดทป้ายทะเบียนปัจจุบัน (รายการทะเบียนที่ลงไว้ทั้งหมด อัปเดตสด) ----------

async function postPlateList(channel) {
  assertCanSend(channel);
  const plates = await db.getAllPlates();
  const listEmbeds = embeds.plateListEmbeds(plates, time.displayThaiDateTime());

  const message = await channel.send({ embeds: listEmbeds });
  await db.setPlateListPanel(channel.id, message.id);
  return message;
}

/**
 * อัปเดตข้อความรายการป้ายทะเบียนที่ปักไว้ให้ตรงกับข้อมูลล่าสุดใน DB
 * เรียกทุกครั้งหลังลงทะเบียน/ลบป้ายทะเบียน
 * ถ้ายังไม่เคยตั้งห้องไว้ หรือหาข้อความเดิมไม่เจอ (ถูกลบไปแล้ว) จะข้ามไปเงียบๆ ไม่ error
 */
async function refreshPlateList(client) {
  const panelInfo = await db.getPlateListPanel();
  if (!panelInfo) return;

  try {
    const channel = await client.channels.fetch(panelInfo.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(panelInfo.messageId);
    if (!message) return;

    const plates = await db.getAllPlates();
    const listEmbeds = embeds.plateListEmbeds(plates, time.displayThaiDateTime());
    await message.edit({ embeds: listEmbeds });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตห้องอัพเดทป้ายทะเบียนได้:", err.message);
  }
}

module.exports = { postPlatePanel, postPlateList, refreshPlateList };
