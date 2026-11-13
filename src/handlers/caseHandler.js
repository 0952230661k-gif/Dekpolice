const {
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");
const config = require("../../config.json");
const db = require("../utils/db");
const embeds = require("../utils/embeds");
const { isAdmin } = require("../utils/permissions");
const time = require("../utils/time");
const caseStats = require("../utils/caseStats");
const { EmbedBuilder } = require("discord.js");

const MENTION_RE = /<@!?(\d{15,25})>/g;

/**
 * แปลงข้อความ 3 บรรทัดเป็นข้อมูลคดี
 *   บรรทัด 1: ชื่อคดี
 *   บรรทัด 2: ค่าปรับ (ไม่ใส่ก็ได้)
 *   บรรทัด 3: แท็กเพื่อนร่วมเคส — all = ทุกคนที่กำลังเข้าเวร, เดิม = ทีมเดียวกับเคสล่าสุดของคุณ
 * รองรับการเว้นบรรทัดที่สอง และคำว่า all หรือแท็กอยู่บรรทัดไหนก็ได้ตั้งแต่บรรทัดที่ 2
 */
async function parseCaseText(text, ownerId) {
  const lines = String(text || "").split("\n").map((l) => l.trim());
  const title = (lines[0] || "").replace(MENTION_RE, "").trim();
  const rest = lines.slice(1);

  let fine = null;
  let wantAll = false;
  let wantSame = false;
  const ids = new Set();

  for (const line of rest) {
    if (!line) continue;
    const plain = line.replace(/,/g, "");
    if (fine === null && /^\d+(\.\d+)?$/.test(plain)) {
      fine = Math.round(Number(plain));
      continue;
    }
    if (/(^|\s)all(\s|$)/i.test(line)) wantAll = true;
    if (/(^|\s)เดิม(\s|$)/.test(line)) wantSame = true;
    for (const m of line.matchAll(MENTION_RE)) ids.add(m[1]);
  }

  if (wantAll) {
    // all = ทุกคนที่เข้าเวรอยู่ (ไม่รวมคนที่อยู่ วอ.12) ยกเว้นคนที่ตั้งสถานะ วอ.12 (ไม่อยู่หน้าจอ)
    const afk = new Set(await db.getAfkIds());
    for (const d of await db.getAllOpenDuty()) if (!afk.has(d.discordId)) ids.add(d.discordId);
  }
  if (wantSame) {
    const last = await db.getLastCaseByOwner(ownerId);
    if (last) last.participants.forEach((p) => ids.add(p));
  }
  ids.delete(ownerId);

  // ต้องมีชื่อในรายชื่อ (ตาราง members) เท่านั้น — คนที่ไม่อยู่ในรายชื่อจะถูกแยกไว้ใน unregistered
  const participants = [];
  const unregistered = [];
  for (const id of ids) {
    if (await db.findMember(id)) participants.push(id);
    else unregistered.push(id);
  }
  return { title, fine, participants, unregistered };
}

async function ownerInfo(guild, ownerId) {
  const member = await guild.members.fetch(ownerId).catch(() => null);
  const reg = await db.findMember(ownerId).catch(() => null);
  return {
    ownerName: member?.displayName || (reg?.gameName ? `[PD] ${reg.gameName}` : "เจ้าหน้าที่"),
    ownerAvatarUrl: member?.displayAvatarURL({ size: 256 }) || null,
  };
}

/** ฟังข้อความในห้องบันทึกคดี แล้วแปลงเป็น embed + ปุ่ม */
async function handleMessage(message) {
  const channelId = config.caseChannelId;
  if (!channelId || channelId.startsWith("ใส่_")) return;
  if (message.author.bot || message.channelId !== channelId || !message.guild) return;

  const tempReply = async (text) => {
    const warn = await message.reply({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => {}), 20000);
  };

  // เจ้าของเคสต้องอยู่ในรายชื่อ ไม่งั้นส่งเคสไม่ได้ (ไม่ลบข้อความเดิม เพื่อให้แก้แล้วส่งใหม่ได้)
  if (!(await db.findMember(message.author.id))) {
    return tempReply("❌ คุณยังไม่มีชื่อในรายชื่อ จึงส่งเคสไม่ได้ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อก่อน");
  }

  const parsed = await parseCaseText(message.content, message.author.id);
  if (parsed.unregistered.length > 0) {
    return tempReply(
      `❌ ส่งเคสไม่ได้ มีคนที่ไม่อยู่ในรายชื่อ: ${parsed.unregistered.map((id) => `<@${id}>`).join(" ")}\nแท็กเฉพาะคนที่มีชื่อในรายชื่อเท่านั้น หรือให้แอดมินเพิ่มชื่อก่อน`
    );
  }
  if (!parsed.title) {
    const warn = await message.reply("⚠️ ต้องพิมพ์ชื่อคดีในบรรทัดแรก\n```\nชื่อคดี\nค่าปรับ (ไม่ใส่ก็ได้)\n@เพื่อนร่วมเคส  หรือพิมพ์ all / เดิม\n```").catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => {}), 15000);
    return;
  }

  // ดาวน์โหลดรูปไว้ก่อนลบข้อความต้นฉบับ (ลบแล้วลิงก์รูปจะหมดอายุ)
  const files = [];
  let imageName = null;
  const img = message.attachments.find((a) => (a.contentType || "").startsWith("image/")) || message.attachments.first();
  if (img) {
    try {
      const res = await fetch(img.url);
      const buf = Buffer.from(await res.arrayBuffer());
      imageName = (img.name || "case.png").replace(/[^\w.\-]/g, "_");
      files.push(new AttachmentBuilder(buf, { name: imageName }));
    } catch (err) {
      console.error("[case] ดาวน์โหลดรูปไม่สำเร็จ:", err.message);
    }
  }

  const caseData = {
    channelId,
    messageId: "pending",
    ownerId: message.author.id,
    title: parsed.title,
    fine: parsed.fine,
    participants: parsed.participants,
    imageName,
    createdAt: new Date().toISOString(),
  };
  const id = await db.addCase(caseData);
  caseData.id = id;

  const info = await ownerInfo(message.guild, message.author.id);
  const sent = await message.channel.send({
    embeds: [embeds.caseEmbed(caseData, { ...info, imageName })],
    components: [embeds.caseRow()],
    files,
    allowedMentions: { parse: [] },
  });

  await db.setCaseMessage(id, sent.id);
  await message.delete().catch(() => {}); // ลบข้อความต้นฉบับให้ห้องสะอาด
}

function canManage(interaction, c) {
  return interaction.user.id === c.ownerId || isAdmin(interaction);
}

function nameOf(interaction) {
  return interaction.member?.displayName || interaction.user.username;
}

async function showMyInfo(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = await db.findMember(interaction.user.id);
  if (!member) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ")] });
  }
  const logs = await db.getDutyLogs(interaction.user.id);
  const hours = time.summarizeLogs(logs);
  const cases = await caseStats.myInfo(interaction.user.id);

  const open = await db.findOpenDuty(interaction.user.id);
  const afk = (await db.getAfkIds()).includes(interaction.user.id);
  const statusText = open ? (afk ? "💤 ไม่อยู่หน้าจอ" : "🟢 เข้าเวร") : "🔻 ออกเวร";

  const reg = member.registeredAt ? new Date(member.registeredAt) : null;
  const tenureDays = reg && !isNaN(reg) ? Math.max(0, Math.floor((Date.now() - reg.getTime()) / 86400000)) : 0;

  await interaction.editReply({
    embeds: [
      embeds.workInfoEmbed({
        displayName: nameOf(interaction),
        avatarUrl: interaction.user.displayAvatarURL({ size: 256 }),
        statusText,
        tenureDays,
        hours,
        cases,
        fmt: caseStats.fmtMinutes,
      }),
    ],
  });
}

async function showRanking(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const board = await caseStats.leaderboard();
  const medals = ["🥇", "🥈", "🥉"];
  const top = board.slice(0, 10);
  const lines = top.map(
    (r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.id}> — สัปดาห์นี้ \`${r.weekTotal}\` (ทำเอง ${r.weekOwn} · ช่วย ${r.weekHelped}) · เดือนนี้ \`${r.monthTotal}\``
  );
  const mine = board.findIndex((r) => r.id === interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle("🏆 อันดับเคส")
    .setDescription(lines.length ? lines.join("\n") : "ยังไม่มีข้อมูลเคส")
    .setFooter({ text: mine >= 0 ? `อันดับของคุณ: ${mine + 1} จาก ${board.length} คน` : "คุณยังไม่มีเคส" });
  await interaction.editReply({ embeds: [embed] });
}

async function showAllTotals(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ embeds: [embeds.errorEmbed("ปุ่มนี้สำหรับแอดมินเท่านั้น")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const board = await caseStats.leaderboard();
  const lines = board.map(
    (r) => `<@${r.id}> — สัปดาห์ \`${r.weekTotal}\` · เดือน \`${r.monthTotal}\` · รวม \`${r.total}\` · ปรับ \`${r.totalFine.toLocaleString("en-US")}\``
  );
  let text = lines.join("\n") || "ยังไม่มีข้อมูลเคส";
  if (text.length > 3900) text = text.slice(0, 3900).replace(/\n[^\n]*$/, "") + "\n…";
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📊 ยอดเคสทุกคน").setDescription(text).setFooter({ text: `ทั้งหมด ${board.length} คน` })],
  });
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === "case_info") return showMyInfo(interaction);
  if (id === "case_rank") return showRanking(interaction);
  if (id === "case_all") return showAllTotals(interaction);

  const c = await db.getCaseByMessage(interaction.message.id);
  if (!c) {
    return interaction.reply({ embeds: [embeds.errorEmbed("ไม่พบข้อมูลคดีนี้ในระบบ")], flags: MessageFlags.Ephemeral });
  }
  if (!canManage(interaction, c)) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("เฉพาะเจ้าของคดีหรือแอดมินเท่านั้นที่แก้ไข/ยกเลิกได้")],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === "case_cancel") {
    const modal = new ModalBuilder().setCustomId("case_modal_cancel").setTitle("ยกเลิกเคส");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel("เหตุผลที่ยกเลิก").setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (id === "case_edit") {
    const modal = new ModalBuilder().setCustomId("case_modal_edit").setTitle("แก้ไขบันทึกคดี");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("ชื่อคดี").setStyle(TextInputStyle.Short).setValue(c.title).setMaxLength(100).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("fine").setLabel("ค่าปรับ (ไม่ใส่ก็ได้)").setStyle(TextInputStyle.Short).setValue(c.fine ? String(c.fine) : "").setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("partners")
          .setLabel("ผู้ช่วยเหลือ (แท็ก / all / เดิม)")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(c.participants.map((pid) => `<@${pid}>`).join(" "))
          .setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }
}

async function handleModalSubmit(interaction) {
  const c = await db.getCaseByMessage(interaction.message?.id);
  if (!c || c.status !== "active" || !canManage(interaction, c)) {
    return interaction.reply({ embeds: [embeds.errorEmbed("ไม่สามารถแก้ไขคดีนี้ได้")], flags: MessageFlags.Ephemeral });
  }
  const info = await ownerInfo(interaction.guild, c.ownerId);

  if (interaction.customId === "case_modal_cancel") {
    c.status = "cancelled";
    c.cancelledBy = interaction.user.id;
    c.cancelledAt = new Date().toISOString();
    c.cancelReason = interaction.fields.getTextInputValue("reason").trim();
    await db.cancelCase(c.id, c.cancelledBy, c.cancelReason, c.cancelledAt);
    return interaction.update({
      embeds: [embeds.caseEmbed(c, { ...info, imageName: c.imageName })],
      components: [],
      allowedMentions: { parse: [] },
    });
  }

  const title = interaction.fields.getTextInputValue("title").trim();
  const text = [title, interaction.fields.getTextInputValue("fine"), interaction.fields.getTextInputValue("partners")].join("\n");
  const parsed = await parseCaseText(text, c.ownerId);
  if (parsed.unregistered.length > 0) {
    return interaction.reply({
      embeds: [embeds.errorEmbed(`มีคนที่ไม่อยู่ในรายชื่อ: ${parsed.unregistered.map((id) => `<@${id}>`).join(" ")}\nแท็กเฉพาะคนที่มีชื่อในรายชื่อเท่านั้น`)],
      flags: MessageFlags.Ephemeral,
    });
  }
  c.title = parsed.title || c.title;
  c.fine = parsed.fine;
  c.participants = parsed.participants;
  await db.updateCase(c.id, c);
  await interaction.update({
    embeds: [embeds.caseEmbed(c, { ...info, imageName: c.imageName })],
    components: [embeds.caseRow()],
    allowedMentions: { parse: [] },
  });
}

module.exports = { handleMessage, handleButton, handleModalSubmit };
