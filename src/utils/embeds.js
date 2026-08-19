const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("../../config.json");

function registerEmbed({ discordName, gameName, position, addedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 เพิ่มสมาชิกสำเร็จ")
    .addFields(
      { name: "Discord", value: discordName, inline: true },
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position, inline: true }
    )
    .setTimestamp();

  if (addedBy) {
    embed.addFields({ name: "เพิ่มโดย", value: addedBy, inline: true });
  }

  return embed;
}

function checkInEmbed({ discordUser, gameName, position, time, via }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("🟢 เข้าเวร")
    .setDescription(
      discordUser ? `<@${discordUser.id}> **(${gameName})** ได้เข้าเวรแล้ว ✅` : `**${gameName}** ได้เข้าเวรแล้ว ✅`
    )
    .addFields(
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลา", value: time, inline: true }
    )
    .setTimestamp();

  if (discordUser) {
    embed.setAuthor({ name: discordUser.tag, iconURL: discordUser.displayAvatarURL() });
  }
  if (via) {
    embed.setFooter({ text: `ผ่าน: ${via}` });
  }

  return embed;
}

function checkOutEmbed({ discordUser, gameName, position, checkIn, checkOut, hours, via }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🔴 ออกเวร")
    .setDescription(
      discordUser ? `<@${discordUser.id}> **(${gameName})** ได้ออกเวรแล้ว 🏁` : `**${gameName}** ได้ออกเวรแล้ว 🏁`
    )
    .addFields(
      { name: "ชื่อ", value: gameName, inline: true },
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้า", value: checkIn, inline: true },
      { name: "เวลาออก", value: checkOut, inline: true },
      { name: "รวม", value: `${hours} ชั่วโมง`, inline: false }
    )
    .setTimestamp();

  if (discordUser) {
    embed.setAuthor({ name: discordUser.tag, iconURL: discordUser.displayAvatarURL() });
  }
  if (via) {
    embed.setFooter({ text: `ผ่าน: ${via}` });
  }

  return embed;
}

// ---------- Log แบบเรียบร้อย สำหรับส่งเข้าห้อง log (สไตล์เดียวกับแผงเข้าเวร) ----------

function checkInLogEmbed({ discordUser, gameName, position, time }) {
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setDescription(`🟢 **${gameName}** เข้าเวรแล้ว${discordUser ? ` — <@${discordUser.id}>` : ""}`)
    .addFields(
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้าเวร", value: time, inline: true }
    )
    .setFooter({ text: "MEDIC DUTY SYSTEM • Duty System" })
    .setTimestamp();

  if (discordUser) embed.setThumbnail(discordUser.displayAvatarURL());

  return embed;
}

function checkOutLogEmbed({ discordUser, gameName, position, checkIn, checkOut, hours }) {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setDescription(`🔴 **${gameName}** ออกเวรแล้ว${discordUser ? ` — <@${discordUser.id}>` : ""}`)
    .addFields(
      { name: "ตำแหน่ง", value: position || "-", inline: true },
      { name: "เวลาเข้า", value: checkIn, inline: true },
      { name: "เวลาออก", value: checkOut, inline: true },
      { name: "รวมชั่วโมง", value: `${hours} ชม.`, inline: true }
    )
    .setFooter({ text: "MEDIC DUTY SYSTEM • Duty System" })
    .setTimestamp();

  if (discordUser) embed.setThumbnail(discordUser.displayAvatarURL());

  return embed;
}

function hoursEmbed({ gameName, hoursToday, hoursWeek, hoursMonth, dutyCount }) {
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`⏱️ ชั่วโมงเข้าเวรของ ${gameName}`)
    .addFields(
      { name: "วันนี้", value: `${hoursToday} ชม.`, inline: true },
      { name: "สัปดาห์นี้", value: `${hoursWeek} ชม.`, inline: true },
      { name: "เดือนนี้", value: `${hoursMonth} ชม.`, inline: true },
      { name: "จำนวนครั้งที่เข้าเวร", value: `${dutyCount} ครั้ง`, inline: false }
    )
    .setTimestamp();
}

function adminActionEmbed(title, description, fields = []) {
  return new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
}

// ---------- แผงเข้าเวร (ปุ่มเข้าเวร/ออกเวรแบบข้อความปักหมุด) ----------

function dutyPanelEmbeds(onDutyList = []) {
  const count = onDutyList.length;
  const statusColor = count > 0 ? 0x57f287 : 0x3b3f47;
  const statusDot = count > 0 ? "🟢" : "⚪";

  const headerEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🚑 ระบบลงเวลาเข้าเวร");

  const infoEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription("กดปุ่มด้านล่างเพื่อเข้า/ออกเวร");

  const listText =
    count > 0
      ? onDutyList.map((d) => `\`${d.name}\``).join("\n")
      : "ไม่มีใครเข้าเวรในขณะนี้";

  const statusEmbed = new EmbedBuilder()
    .setColor(statusColor)
    .setDescription(`${statusDot} **กำลังเข้าเวร (${count} คน)**\n${listText}`)
    .setFooter({ text: "MEDIC DUTY SYSTEM • Duty System" })
    .setTimestamp();

  return [headerEmbed, infoEmbed, statusEmbed];
}

function dutyPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("duty_checkin")
      .setLabel("เข้าเวร")
      .setEmoji("🟢")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("duty_checkout")
      .setLabel("ออกเวร")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger)
  );
}

// ---------- ห้องรายชื่อ (รายชื่อสมาชิกแยกตามตำแหน่ง) ----------

const ROSTER_DIVIDER = "> ══════════════════════";
const ROSTER_CHUNK_LIMIT = 3800; // เผื่อพื้นที่ไว้ไม่ให้ชนลิมิต 4096 ตัวอักษรของ embed description

function rosterEmbeds(members, positions, title, updatedAtText) {
  const grouped = new Map(positions.map((pos) => [pos, []]));
  const others = [];

  for (const m of members) {
    if (grouped.has(m.position)) {
      grouped.get(m.position).push(m.gameName);
    } else {
      others.push(m.gameName);
    }
  }

  // สร้างเป็นรายบรรทัด (ไม่ใช่รายท่อน) เพื่อให้แบ่ง chunk ได้แม้แต่ตำแหน่งเดียวจะมีคนเยอะมากจนเกินลิมิตของ 1 embed
  const lines = [];
  for (const pos of positions) {
    lines.push(`## ${pos}`);
    const names = grouped.get(pos);
    if (names.length === 0) {
      lines.push("`-`");
    } else {
      names.forEach((n) => lines.push(`\`${n}\``));
    }
  }
  if (others.length > 0) {
    lines.push("## อื่นๆ");
    others.forEach((n) => lines.push(`\`${n}\``));
  }

  const header = `# ${title}\n${ROSTER_DIVIDER}`;
  const footer = `${ROSTER_DIVIDER}\n> อัปเดตล่าสุด : ${updatedAtText} | จำนวนทั้งหมด ${members.length} คน`;

  // แบ่งเป็นหลาย embed ถ้าเนื้อหายาวเกินไป (รองรับได้สูงสุด 10 embeds ต่อข้อความ)
  const chunks = [];
  let current = header;

  for (const line of lines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > ROSTER_CHUNK_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  chunks.push(current);

  // เติมบรรทัดอัปเดตล่าสุดต่อท้าย embed สุดท้าย (แยก embed ใหม่ถ้าไม่พอที่)
  const lastIndex = chunks.length - 1;
  if (chunks[lastIndex].length + footer.length + 1 <= ROSTER_CHUNK_LIMIT) {
    chunks[lastIndex] += `\n${footer}`;
  } else {
    chunks.push(footer);
  }

  return chunks
    .slice(0, 10) // Discord จำกัดสูงสุด 10 embeds ต่อข้อความ
    .map((desc) => new EmbedBuilder().setColor(0x5865f2).setDescription(desc));
}

function errorEmbed(message) {
  return new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${message}`);
}

function successEmbed(message) {
  return new EmbedBuilder().setColor(0x57f287).setDescription(`✅ ${message}`);
}

// ---------- ระบบคิวแพทย์ (Queue) ----------

const QUEUE_DIVIDER = "━━━━━━━━━━━━━━━━━━";

function queueEmbed({ ready = [], onCase = [], onBreak = [], loop = [] }) {
  const lines = ["🏥 **ระบบคิวแพทย์ประจำเวร**", QUEUE_DIVIDER, "", "🟢 **คิวพร้อมรับเคส**", ""];

  if (ready.length === 0) {
    lines.push("> _ไม่มีใครอยู่ในคิว_");
  } else {
    ready.forEach((r, i) => lines.push(`> ${i + 1}. 👨‍⚕️ <@${r.discordId}> (${r.name})`));
  }

  lines.push("", QUEUE_DIVIDER, "", "🚑 **กำลังรับเคส**", "");
  if (onCase.length === 0) {
    lines.push("> _ไม่มีใครกำลังรับเคส_");
  } else {
    onCase.forEach((m) => {
      lines.push(`> <@${m.discordId}> (${m.name})`);
      lines.push(`> เริ่มรับเคส: ${m.startedAtText}`);
    });
  }

  lines.push("", QUEUE_DIVIDER, "", "☕ **กำลังพัก**", "");
  if (onBreak.length === 0) {
    lines.push("> _ไม่มีใครกำลังพัก_");
  } else {
    onBreak.forEach((m) => {
      lines.push(`> <@${m.discordId}> (${m.name})`);
      lines.push(`> เหลือเวลา ${m.remainingMinutes} นาที`);
    });
  }

  lines.push("", QUEUE_DIVIDER, "", "🔄 **ชุบลูป**", "");
  if (loop.length === 0) {
    lines.push("> _ไม่มีใครชุบลูปอยู่_");
  } else {
    loop.forEach((m) => lines.push(`> <@${m.discordId}> (${m.name})`));
  }

  const total = ready.length + onCase.length + onBreak.length + loop.length;
  lines.push(
    "",
    QUEUE_DIVIDER,
    "",
    `👥 **แพทย์เข้าเวรทั้งหมด:** ${total} คน`,
    "",
    `🟢 พร้อม: ${ready.length} คน`,
    `🚑 รับเคส: ${onCase.length} คน`,
    `☕ พัก: ${onBreak.length} คน`,
    `🔄 ชุบลูป: ${loop.length} คน`
  );

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "MEDIC DUTY SYSTEM • Queue System" })
    .setTimestamp();
}

function queueMainRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("q_takecase").setLabel("รับเคส").setEmoji("🚑").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("q_endcase").setLabel("จบเคส").setEmoji("✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("q_break").setLabel("พัก").setEmoji("☕").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("q_loop").setLabel("ชุบลูป").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("q_return").setLabel("กลับเข้าคิว").setEmoji("🟢").setStyle(ButtonStyle.Success)
  );
}

function queueBreakDurationRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("q_break_15").setLabel("15 นาที").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("q_break_30").setLabel("30 นาที").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("q_break_60").setLabel("60 นาที").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("q_break_custom").setLabel("กำหนดเวลาเอง").setEmoji("✏️").setStyle(ButtonStyle.Primary)
  );
}

// ---------- ระบบลงทะเบียนป้ายทะเบียนรถ ----------

function plateSubmitPanelEmbeds() {
  const headerEmbed = new EmbedBuilder().setColor(0x5865f2).setTitle("🚘 ระบบลงทะเบียนป้ายทะเบียนรถ");

  const infoEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription("กดปุ่มด้านล่างเพื่อลงทะเบียนป้ายทะเบียนรถคันใหม่ (เลขทะเบียน + ชื่อเจ้าของ/ผู้ขับ)")
    .setFooter({ text: "MEDIC DUTY SYSTEM • Plate Registration" })
    .setTimestamp();

  return [headerEmbed, infoEmbed];
}

function plateSubmitRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("plate_register").setLabel("ลงทะเบียนใหม่").setEmoji("🚘").setStyle(ButtonStyle.Primary)
  );
}

const PLATE_DIVIDER = "> ══════════════════════";
const PLATE_CHUNK_LIMIT = 3800;

function plateListEmbeds(plates, updatedAtText) {
  const header = `# 🚘 ทะเบียนรถที่ลงทะเบียนไว้\n${PLATE_DIVIDER}`;
  const footer = `${PLATE_DIVIDER}\n> อัปเดตล่าสุด : ${updatedAtText} | จำนวนทั้งหมด ${plates.length} คัน`;

  const lines =
    plates.length === 0
      ? ["`ยังไม่มีการลงทะเบียนป้ายทะเบียน`"]
      : plates.map((p) => `\`${p.plateNumber}\` — เจ้าของ/ผู้ขับ: ${p.ownerName}`);

  const chunks = [];
  let current = header;
  for (const line of lines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > PLATE_CHUNK_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  chunks.push(current);

  const lastIndex = chunks.length - 1;
  if (chunks[lastIndex].length + footer.length + 1 <= PLATE_CHUNK_LIMIT) {
    chunks[lastIndex] += `\n${footer}`;
  } else {
    chunks.push(footer);
  }

  return chunks.slice(0, 10).map((desc) => new EmbedBuilder().setColor(0x5865f2).setDescription(desc));
}

// ---------- ระบบใบสมัคร (สมัครเข้าหน่วยงานผ่านปุ่ม + ห้องผู้อนุมัติ) ----------

function applicationMenuEmbed(departments) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📝 ใบสมัครเข้าหน่วยงาน")
    .setDescription(
      `กดปุ่มด้านล่างเพื่อเลือกหน่วยงานที่ต้องการสมัคร แล้วกรอกแบบฟอร์มใบสมัคร\n\nหน่วยงานที่เปิดรับ: ${departments
        .map((d) => `\`${d}\``)
        .join(" ")}`
    )
    .setFooter({ text: "MEDIC DUTY SYSTEM • Application" })
    .setTimestamp();
}

function applicationMenuRow(departments) {
  const row = new ActionRowBuilder();
  for (const dept of departments.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`form_apply_${dept}`)
        .setLabel(`สมัคร ${dept}`)
        .setEmoji("📝")
        .setStyle(ButtonStyle.Primary)
    );
  }
  return row;
}

function applicationReviewEmbed(app, reviewerTag) {
  const isPending = app.status === "รอตรวจสอบ";
  const approved = app.status === "อนุมัติ";

  const embed = new EmbedBuilder()
    .setColor(isPending ? 0xfee75c : approved ? 0x57f287 : 0xed4245)
    .setTitle(isPending ? "📥 ใบสมัครใหม่ — รอตรวจสอบ" : approved ? "✅ ใบสมัคร — อนุมัติแล้ว" : "❌ ใบสมัคร — ปฏิเสธแล้ว")
    .setDescription(`<@${app.discordId}> ส่งใบสมัครเข้าหน่วยงาน **${app.department}**`)
    .addFields(
      { name: "ชื่อ", value: app.gameName, inline: true },
      { name: "อายุ", value: app.age || "-", inline: true },
      { name: "เบอร์ในเมือง", value: app.phone || "-", inline: true },
      { name: "ชื่อผู้คุมสอบ", value: app.examinerName || "-", inline: true },
      { name: "ลิงค์ Steam", value: app.steamLink || "-", inline: true },
      { name: "Discord", value: app.discordId, inline: true }
    )
    .setFooter({ text: `Application #${app.id}` })
    .setTimestamp();

  if (!isPending && reviewerTag) {
    embed.addFields({ name: approved ? "อนุมัติโดย" : "ปฏิเสธโดย", value: reviewerTag, inline: false });
  }

  return embed;
}

function applicationReviewRow(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`form_approve_${id}`)
      .setLabel("อนุมัติ")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`form_reject_${id}`)
      .setLabel("ปฏิเสธ")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function applicationResultEmbed(app, guildId) {
  const approved = app.status === "อนุมัติ";

  let description;
  if (approved) {
    description = `ยินดีต้อนรับเข้าสู่หน่วยงาน **${app.department}**! ตอนนี้คุณสามารถใช้คำสั่ง \`/เข้าเวร\` ได้แล้ว`;

    const channelId = config.dutyChannelId;
    if (guildId && channelId && !channelId.startsWith("ใส่_")) {
      description += `\n\nให้ไปเข้าเวรในห้องนี้ด้วยนะจ๊ะ 🟢\nhttps://discord.com/channels/${guildId}/${channelId}`;
    }
  } else {
    description = `ใบสมัครเข้าหน่วยงาน **${app.department}** ของคุณถูกปฏิเสธ ติดต่อแอดมินหากมีข้อสงสัย`;
  }

  return new EmbedBuilder()
    .setColor(approved ? 0x57f287 : 0xed4245)
    .setTitle(approved ? "✅ ใบสมัครของคุณได้รับการอนุมัติ" : "❌ ใบสมัครของคุณถูกปฏิเสธ")
    .setDescription(description)
    .setFooter({ text: `Application #${app.id}` })
    .setTimestamp();
}

module.exports = {
  registerEmbed,
  checkInEmbed,
  checkOutEmbed,
  checkInLogEmbed,
  checkOutLogEmbed,
  hoursEmbed,
  adminActionEmbed,
  errorEmbed,
  successEmbed,
  dutyPanelEmbeds,
  dutyPanelRow,
  rosterEmbeds,
  queueEmbed,
  queueMainRow,
  queueBreakDurationRow,
  plateSubmitPanelEmbeds,
  plateSubmitRow,
  plateListEmbeds,
  applicationMenuEmbed,
  applicationMenuRow,
  applicationReviewEmbed,
  applicationReviewRow,
  applicationResultEmbed,
};
