const {
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
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

async function ownerInfo(guild, c) {
  const member = await guild.members.fetch(c.ownerId).catch(() => null);
  // ชื่อที่แสดงในเคสมาจากรายชื่อ (members) เท่านั้น ไม่ใช้ชื่อ Discord
  const names = {};
  for (const id of new Set([c.ownerId, c.cancelledBy, ...c.participants].filter(Boolean))) {
    const reg = await db.findMember(id).catch(() => null);
    if (reg) {
      const base = reg.position ? `[${reg.position}] ${reg.gameName}` : reg.gameName; // ขึ้นยศตามรายชื่อ
      names[id] = reg.badgeNumber ? `${embeds.formatBadge(reg.badgeNumber)} ${base}` : base; // เลขประจำตัว → ยศ → ชื่อ
    }
  }
  return {
    ownerName: names[c.ownerId] || "เจ้าหน้าที่",
    ownerAvatarUrl: member?.displayAvatarURL({ size: 256 }) || null,
    names,
  };
}

/** ฟังข้อความในห้องบันทึกคดี แล้วแปลงเป็น embed + ปุ่ม */
async function handleMessage(message) {
  const channelId = config.caseChannelId;
  if (!channelId || channelId.startsWith("ใส่_")) return;
  if (message.author.bot || message.channelId !== channelId || !message.guild) return;

  // ส่งไม่ผ่าน: ลบข้อความต้นฉบับ (รวมรูปที่แนบ) ทิ้งทุกกรณี แล้วแจ้งเหตุผลชั่วคราวพร้อมข้อความเดิม จะได้พิมพ์ส่งใหม่ได้
  const reject = async (text) => {
    const original = String(message.content || "").replace(/`/g, "'").slice(0, 300);
    await message.delete().catch(() => {});
    const warn = await message.channel
      .send({
        content: `<@${message.author.id}> ${text}${original ? `\n**ข้อความเดิมของคุณ**\n\`\`\`\n${original}\n\`\`\`` : ""}`,
        allowedMentions: { parse: [] },
      })
      .catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => {}), 30000);
  };

  // เจ้าของเคสต้องอยู่ในรายชื่อ ไม่งั้นส่งเคสไม่ได้
  if (!(await db.findMember(message.author.id))) {
    return reject("❌ คุณยังไม่มีชื่อในรายชื่อ จึงส่งเคสไม่ได้ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อก่อน");
  }

  const parsed = await parseCaseText(message.content, message.author.id);
  if (parsed.unregistered.length > 0) {
    return reject(
      `❌ ส่งเคสไม่ได้ มีคนที่ไม่อยู่ในรายชื่อ: ${parsed.unregistered.map((id) => `<@${id}>`).join(" ")}\nแท็กเฉพาะคนที่มีชื่อในรายชื่อเท่านั้น หรือให้แอดมินเพิ่มชื่อก่อน`
    );
  }
  if (!parsed.title) {
    return reject("⚠️ ต้องพิมพ์ชื่อคดีในบรรทัดแรก\n```\nชื่อคดี\nค่าปรับ (ไม่ใส่ก็ได้)\n@เพื่อนร่วมเคส  หรือพิมพ์ all / เดิม\n```");
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

  const info = await ownerInfo(message.guild, caseData);
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

  const tenureDays = time.daysSince(member.registeredAt);

  await interaction.editReply({
    embeds: [
      embeds.workInfoEmbed({
        badgeNumber: member.badgeNumber,
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

const REMOVE_PAGE_SIZE = 25;

/** หน้าลดผู้ช่วยเหลือ แบ่งหน้าละ 25 คน (ข้อจำกัดเมนูของ Discord) เพื่อให้ลดได้ครบแม้มีผู้ช่วยหลายสิบคน */
async function buildRemoveUi(c, caseMessageId, page) {
  const pages = Math.max(1, Math.ceil(c.participants.length / REMOVE_PAGE_SIZE));
  page = Math.min(Math.max(page, 0), pages - 1);
  const slice = c.participants.slice(page * REMOVE_PAGE_SIZE, (page + 1) * REMOVE_PAGE_SIZE);
  const options = [];
  for (const pid of slice) {
    const reg = await db.findMember(pid).catch(() => null);
    options.push({
      label: (reg ? `${reg.badgeNumber ? embeds.formatBadge(reg.badgeNumber) + " " : ""}${reg.gameName}` : pid).slice(0, 100),
      value: pid,
    });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`case_sel_remove:${caseMessageId}`)
    .setPlaceholder("เลือกคนที่จะลดออกจากผู้ช่วยเหลือ")
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);
  const rows = [new ActionRowBuilder().addComponents(menu)];
  if (pages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`case_rempg:${caseMessageId}:${page - 1}`).setLabel("ก่อนหน้า").setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`case_rempg:${caseMessageId}:${page + 1}`).setLabel("ถัดไป").setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
      )
    );
  }
  return {
    content: `➖ **ลดผู้ช่วยเหลือ** ในเคส "${c.title}" — ทั้งหมด ${c.participants.length} คน (หน้า ${page + 1}/${pages})`,
    components: rows,
  };
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id === "case_info") return showMyInfo(interaction);
  if (id === "case_rank") return showRanking(interaction);
  if (id === "case_all") return showAllTotals(interaction);

  // ปุ่มที่อยู่ในข้อความชั่วคราว (ephemeral) แนบรหัสข้อความเคสไว้ใน customId
  if (id.startsWith("case_addtext:") || id.startsWith("case_rempg:")) {
    const [kind, caseMessageId, pageStr] = id.split(":");
    const target = await db.getCaseByMessage(caseMessageId);
    if (!target || target.status !== "active" || !canManage(interaction, target)) {
      return interaction.update({ content: "❌ ไม่พบเคสนี้ หรือไม่มีสิทธิ์จัดการ", components: [] });
    }
    if (kind === "case_rempg") {
      return interaction.update(await buildRemoveUi(target, caseMessageId, parseInt(pageStr, 10) || 0));
    }
    const modal = new ModalBuilder().setCustomId(`case_modal_addtext:${caseMessageId}`).setTitle("เพิ่มผู้ช่วยเหลือหลายคน");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("people")
          .setLabel("แท็กคนที่จะเพิ่ม (กี่คนก็ได้) หรือพิมพ์ all")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("@คน1 @คน2 @คน3 ...")
          .setMaxLength(4000)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

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

  if (id === "case_helper_add") {
    if (c.status !== "active") return;
    const menu = new UserSelectMenuBuilder()
      .setCustomId(`case_sel_add:${interaction.message.id}`)
      .setPlaceholder("เลือกคนที่จะเพิ่มเป็นผู้ช่วยเหลือ (เมนูละสูงสุด 25 คน)")
      .setMinValues(1)
      .setMaxValues(25);
    const textBtn = new ButtonBuilder()
      .setCustomId(`case_addtext:${interaction.message.id}`)
      .setLabel("พิมพ์แท็กหลายคน / all")
      .setEmoji("⌨️")
      .setStyle(ButtonStyle.Primary);
    return interaction.reply({
      content:
        `➕ **เพิ่มผู้ช่วยเหลือ** ในเคส "${c.title}" — ไม่จำกัดจำนวน (ปัจจุบัน ${c.participants.length} คน)\n` +
        `เลือกจากเมนู (เพิ่มกี่รอบก็ได้) หรือกดปุ่มด้านล่างเพื่อพิมพ์แท็กได้ครั้งละมากๆ / พิมพ์ \`all\` เพื่อเพิ่มทุกคนที่เข้าเวร\n` +
        `เพิ่มได้เฉพาะคนที่มีชื่อในรายชื่อ`,
      components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(textBtn)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === "case_helper_remove") {
    if (c.status !== "active") return;
    if (c.participants.length === 0) {
      return interaction.reply({ embeds: [embeds.errorEmbed("เคสนี้ยังไม่มีผู้ช่วยเหลือให้ลดออก")], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...(await buildRemoveUi(c, interaction.message.id, 0)), flags: MessageFlags.Ephemeral });
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

/** เมนูเลือกคนจากปุ่ม เพิ่ม/ลด ผู้ช่วยเหลือ (customId = case_sel_add:<messageId> / case_sel_remove:<messageId>) */
async function handleSelect(interaction) {
  const [kind, caseMessageId] = interaction.customId.split(":");
  const c = await db.getCaseByMessage(caseMessageId);
  if (!c || c.status !== "active") {
    return interaction.update({ content: "❌ ไม่พบเคสนี้ หรือเคสถูกยกเลิกแล้ว", components: [] });
  }
  if (!canManage(interaction, c)) {
    return interaction.update({ content: "❌ เฉพาะเจ้าของคดีหรือแอดมินเท่านั้น", components: [] });
  }

  let summary;
  if (kind === "case_sel_add") {
    const added = [];
    const skippedUnregistered = [];
    const already = [];
    for (const pid of interaction.values) {
      if (pid === c.ownerId || c.participants.includes(pid)) { already.push(pid); continue; }
      if (!(await db.findMember(pid))) { skippedUnregistered.push(pid); continue; }
      c.participants.push(pid);
      added.push(pid);
    }
    const lines = [];
    if (added.length) lines.push(`✅ เพิ่มแล้ว ${added.length} คน: ${added.map((x) => `<@${x}>`).join(" ")}`);
    if (already.length) lines.push(`ℹ️ อยู่ในเคสอยู่แล้ว/เป็นเจ้าของเคส: ${already.map((x) => `<@${x}>`).join(" ")}`);
    if (skippedUnregistered.length) lines.push(`❌ ไม่อยู่ในรายชื่อ เพิ่มไม่ได้: ${skippedUnregistered.map((x) => `<@${x}>`).join(" ")}`);
    summary = lines.join("\n");
  } else {
    const removeSet = new Set(interaction.values);
    c.participants = c.participants.filter((p) => !removeSet.has(p));
    summary = `✅ ลดผู้ช่วยเหลือออก ${removeSet.size} คน: ${[...removeSet].map((x) => `<@${x}>`).join(" ")}`;
  }

  await db.updateCase(c.id, c);

  // อัปเดตข้อความเคสเดิมในห้อง (รูปเดิมยังอยู่ ไม่ต้องอัปโหลดใหม่)
  const info = await ownerInfo(interaction.guild, c);
  const caseMessage = await interaction.channel.messages.fetch(caseMessageId).catch(() => null);
  if (caseMessage) {
    await caseMessage.edit({
      embeds: [embeds.caseEmbed(c, { ...info, imageName: c.imageName })],
      components: [embeds.caseRow()],
      allowedMentions: { parse: [] },
    });
  }
  await interaction.update({ content: summary, components: [], allowedMentions: { parse: [] } });
}

/** เพิ่มผู้ช่วยเหลือจากข้อความที่พิมพ์ (แท็กหลายคน/all) ไม่จำกัดจำนวน */
async function handleAddText(interaction) {
  const caseMessageId = interaction.customId.split(":")[1];
  const c = await db.getCaseByMessage(caseMessageId);
  if (!c || c.status !== "active" || !canManage(interaction, c)) {
    return interaction.reply({ embeds: [embeds.errorEmbed("ไม่พบเคสนี้ หรือไม่มีสิทธิ์จัดการ")], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = await parseCaseText(`x\n${interaction.fields.getTextInputValue("people")}`, c.ownerId);
  const added = parsed.participants.filter((p) => !c.participants.includes(p));
  c.participants.push(...added);
  await db.updateCase(c.id, c);

  const info = await ownerInfo(interaction.guild, c);
  const caseMessage = await interaction.channel.messages.fetch(caseMessageId).catch(() => null);
  if (caseMessage) {
    await caseMessage.edit({
      embeds: [embeds.caseEmbed(c, { ...info, imageName: c.imageName })],
      components: [embeds.caseRow()],
      allowedMentions: { parse: [] },
    });
  }

  const lines = [`✅ เพิ่มแล้ว ${added.length} คน (ผู้ช่วยทั้งหมด ${c.participants.length} คน)`];
  const dup = parsed.participants.length - added.length;
  if (dup > 0) lines.push(`ℹ️ ข้าม ${dup} คนที่อยู่ในเคสอยู่แล้ว`);
  if (parsed.unregistered.length > 0) {
    lines.push(`❌ ไม่อยู่ในรายชื่อ เพิ่มไม่ได้ ${parsed.unregistered.length} คน: ${parsed.unregistered.slice(0, 20).map((x) => `<@${x}>`).join(" ")}`);
  }
  await interaction.editReply({ content: lines.join("\n"), allowedMentions: { parse: [] } });
}

async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith("case_modal_addtext:")) return handleAddText(interaction);
  const c = await db.getCaseByMessage(interaction.message?.id);
  if (!c || c.status !== "active" || !canManage(interaction, c)) {
    return interaction.reply({ embeds: [embeds.errorEmbed("ไม่สามารถแก้ไขคดีนี้ได้")], flags: MessageFlags.Ephemeral });
  }
  const info = await ownerInfo(interaction.guild, c);

  if (interaction.customId === "case_modal_cancel") {
    c.status = "cancelled";
    c.cancelledBy = interaction.user.id;
    c.cancelledAt = new Date().toISOString();
    c.cancelReason = interaction.fields.getTextInputValue("reason").trim();
    await db.cancelCase(c.id, c.cancelledBy, c.cancelReason, c.cancelledAt);
    const cancelInfo = await ownerInfo(interaction.guild, c);
    return interaction.update({
      embeds: [embeds.caseEmbed(c, { ...cancelInfo, imageName: c.imageName })],
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
  const info2 = await ownerInfo(interaction.guild, c);
  await interaction.update({
    embeds: [embeds.caseEmbed(c, { ...info2, imageName: c.imageName })],
    components: [embeds.caseRow()],
    allowedMentions: { parse: [] },
  });
}

module.exports = { handleMessage, handleButton, handleModalSubmit, handleSelect };
