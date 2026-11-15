const { PermissionsBitField } = require("discord.js");
const db = require("./db");
const embeds = require("./embeds");
const time = require("./time");
const config = require("../../config.json");

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

/**
 * โพสต์ข้อความรายชื่อใหม่ในห้องที่ระบุ และบันทึกตำแหน่งข้อความไว้ใน DB
 * เพื่อให้บอทหาข้อความนี้เจอและอัปเดตสดได้ทุกครั้งที่มีคนสมัคร/เปลี่ยนตำแหน่ง
 */
async function postRoster(channel) {
  assertCanSend(channel);
  const members = await db.getAllMembers();
  const rosterEmbeds = embeds.rosterEmbeds(
    members,
    config.positions,
    config.rosterTitle || "รายชื่อสมาชิก",
    time.displayThaiDateTime()
  );

  const message = await channel.send({ embeds: rosterEmbeds });
  await db.setRosterPanel(channel.id, message.id);
  return message;
}

/**
 * อัปเดตข้อความรายชื่อที่ปักไว้ให้ตรงกับข้อมูลล่าสุดใน DB
 * เรียกทุกครั้งหลังเพิ่มสมาชิกใหม่ หรือแก้ไขตำแหน่งของสมาชิก
 * ถ้ายังไม่เคยตั้งห้องรายชื่อไว้ หรือหาข้อความเดิมไม่เจอ (ถูกลบไปแล้ว) จะข้ามไปเงียบๆ ไม่ error
 */
async function refreshRoster(client) {
  const rosterPanel = await db.getRosterPanel();
  if (!rosterPanel) return;

  try {
    const channel = await client.channels.fetch(rosterPanel.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(rosterPanel.messageId);
    if (!message) return;

    const members = await db.getAllMembers();
    const rosterEmbeds = embeds.rosterEmbeds(
      members,
      config.positions,
      config.rosterTitle || "รายชื่อสมาชิก",
      time.displayThaiDateTime()
    );

    await message.edit({ embeds: rosterEmbeds });
  } catch (err) {
    console.error("ไม่สามารถอัปเดตห้องรายชื่อได้:", err.message);
  }
}

module.exports = { postRoster, refreshRoster };
