const db = require("./db");
const time = require("./time");
const embeds = require("./embeds");
const queue = require("./queue");

/**
 * เข้าเวร — ใช้ร่วมกันทั้งคำสั่ง /เข้าเวร และปุ่ม "เข้าเวร" บนแผงเข้าเวร
 * @param {import("discord.js").User} discordUser ผู้ใช้ Discord ที่กดปุ่ม/รันคำสั่ง
 * คืนค่า { ok: true, replyEmbed, logEmbed } เมื่อสำเร็จ (replyEmbed = ข้อความส่วนตัว, logEmbed = ข้อความเรียบร้อยสำหรับห้อง log)
 * หรือ { ok: false, embed } เมื่อมีข้อผิดพลาด
 */
async function checkIn(discordUser) {
  const discordId = discordUser.id;

  const member = await db.findMember(discordId);
  if (!member) {
    return { ok: false, embed: embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ") };
  }

  const openDuty = await db.findOpenDuty(discordId);
  if (openDuty) {
    return { ok: false, embed: embeds.errorEmbed("คุณกำลังเข้าเวรอยู่แล้ว กรุณาออกเวรก่อนเข้าเวรครั้งใหม่") };
  }

  const nowIso = time.nowIso();
  await db.addCheckIn({
    discordId,
    name: member.gameName,
    date: time.todayStr(),
    checkIn: nowIso,
    checkOut: "-",
  });

  const displayTime = time.displayDateTime(nowIso);

  const replyEmbed = embeds.checkInEmbed({
    discordUser,
    gameName: member.gameName,
    position: member.position,
    time: displayTime,
  });

  const logEmbed = embeds.checkInLogEmbed({
    discordUser,
    gameName: member.gameName,
    position: member.position,
    time: displayTime,
  });

  await queue.onCheckedIn(discordUser, member);

  return { ok: true, replyEmbed, logEmbed };
}

/**
 * ออกเวร — ใช้ร่วมกันทั้งคำสั่ง /ออกเวร และปุ่ม "ออกเวร" บนแผงเข้าเวร
 * @param {import("discord.js").User} discordUser ผู้ใช้ Discord ที่กดปุ่ม/รันคำสั่ง
 */
async function checkOut(discordUser) {
  const discordId = discordUser.id;

  const openDuty = await db.findOpenDuty(discordId);
  if (!openDuty) {
    return { ok: false, embed: embeds.errorEmbed("คุณยังไม่ได้เข้าเวร ไม่สามารถออกเวรได้") };
  }

  const checkOutIso = time.nowIso();
  const hours = time.hoursBetween(openDuty.checkIn, checkOutIso);

  await db.setCheckOut(openDuty._rowNumber, checkOutIso, hours);

  const member = await db.findMember(discordId);
  const displayCheckIn = time.displayDateTime(openDuty.checkIn);
  const displayCheckOut = time.displayDateTime(checkOutIso);

  const replyEmbed = embeds.checkOutEmbed({
    discordUser,
    gameName: openDuty.name,
    position: member?.position,
    checkIn: displayCheckIn,
    checkOut: displayCheckOut,
    hours,
  });

  const logEmbed = embeds.checkOutLogEmbed({
    discordUser,
    gameName: openDuty.name,
    position: member?.position,
    checkIn: displayCheckIn,
    checkOut: displayCheckOut,
    hours,
  });

  await queue.onCheckedOut(discordUser);

  return { ok: true, replyEmbed, logEmbed };
}

module.exports = { checkIn, checkOut };
