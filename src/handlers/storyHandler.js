const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const story = require("../utils/story");
const config = require("../../config.json");
const { sendLog } = require("../utils/permissions");

const EPHEMERAL = MessageFlags.Ephemeral;

// ====================== ฝั่งสมาชิก (ปุ่มบนแผงเวลาสตอรี่) ======================

function otpModal() {
  const modal = new ModalBuilder().setCustomId("story_modal_otp").setTitle("เข้าเวลาสตอรี่อุ้ม");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("otp")
        .setLabel("OTP จากแอดมิน")
        .setPlaceholder("เช่น 123456")
        .setStyle(TextInputStyle.Short)
        .setMinLength(4)
        .setMaxLength(12)
        .setRequired(true)
    )
  );
  return modal;
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === "story_in") {
    // เช็คเบื้องต้นก่อนเปิดช่องกรอก จะได้ไม่ให้คนที่เข้าไม่ได้เสียเวลากรอก
    if (!(await db.findMember(interaction.user.id))) {
      return interaction.reply({ embeds: [embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ")], flags: EPHEMERAL });
    }
    if (await db.findOpenStory(interaction.user.id)) {
      return interaction.reply({ embeds: [embeds.errorEmbed("คุณอยู่ในเวลาสตอรี่อยู่แล้ว")], flags: EPHEMERAL });
    }
    return interaction.showModal(otpModal());
  }

  if (id === "story_out") {
    await interaction.deferReply({ flags: EPHEMERAL });
    const res = await story.checkOut(interaction.user);
    if (!res.ok) return interaction.editReply({ embeds: [embeds.errorEmbed(res.message)] });
    await interaction.editReply({ embeds: [embeds.successEmbed(res.replyText)] });
    await sendLog(interaction.client, "สตอรี่อุ้ม", res.logEmbed);
    await story.refreshPanel(interaction.client);
    return;
  }

  if (id === "story_me") {
    await interaction.deferReply({ flags: EPHEMERAL });
    const member = await db.findMember(interaction.user.id);
    if (!member) {
      return interaction.editReply({ embeds: [embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณ")] });
    }
    const s = await story.myStats(interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("⏱️ เวลาสตอรี่อุ้มของฉัน")
      .setDescription(
        `**สถานะ:** ${s.open ? `🟢 อยู่ในสตอรี่ (เข้าตั้งแต่ ${time.toTz(s.open.checkIn).format("HH:mm")} น.)` : "🔻 ไม่ได้อยู่ในสตอรี่"}\n\n` +
          `> ⏳ สัปดาห์นี้: **${time.formatDurationThai(s.weekHours)}** (${s.weekSessions} รอบ)\n` +
          `> 🎭 เคสอุ้มสัปดาห์นี้: **${s.weekCases}** เคส`
      );
    return interaction.editReply({ embeds: [embed] });
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId !== "story_modal_otp") return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const code = interaction.fields.getTextInputValue("otp");
  const res = await story.checkIn(interaction.user, code);
  if (!res.ok) return interaction.editReply({ embeds: [embeds.errorEmbed(res.message)] });
  await interaction.editReply({ embeds: [embeds.successEmbed(res.replyText)] });
  await sendLog(interaction.client, "สตอรี่อุ้ม", res.logEmbed);
  await story.refreshPanel(interaction.client);
}

// ====================== ฝั่งแอดมิน (ปุ่มในแผงแอดมิน ap_story_*) ======================
// การเช็คสิทธิ์แอดมินทำที่ adminPanelHandler ก่อนส่งต่อมาที่นี่แล้ว

function adminOtpModal() {
  const modal = new ModalBuilder().setCustomId("ap_modal_story_otp").setTitle("เปิด OTP สตอรี่อุ้ม");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("code")
        .setLabel("OTP ที่ต้องการ (เว้นว่าง = สุ่มเลข 6 หลัก)")
        .setPlaceholder("เช่น 482913 หรือ STORY7 (ตัวเลข/อังกฤษ 4-12 ตัว)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(12)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("minutes")
        .setLabel(`เปิดรับเข้ากี่นาที (เว้นว่าง = ${Number(config.storyOtpMinutes) || 60} นาที)`)
        .setPlaceholder("เช่น 30")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(4)
        .setRequired(false)
    )
  );
  return modal;
}

function endConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ap_story_end_confirm").setLabel("ยืนยันจบสตอรี่").setEmoji("🎬").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ap_story_end_cancel").setLabel("ยกเลิก").setStyle(ButtonStyle.Secondary)
  );
}

async function handleAdminButton(interaction) {
  const id = interaction.customId;

  if (id === "ap_story_open") return interaction.showModal(adminOtpModal());

  if (id === "ap_story_close") {
    await interaction.deferReply({ flags: EPHEMERAL });
    const n = await story.closeOtp();
    await story.refreshPanel(interaction.client);
    const embed = embeds.adminActionEmbed("🔒 ปิด OTP สตอรี่อุ้ม", n > 0 ? "ปิดรับเข้าสตอรี่แล้ว (คนที่อยู่ในสตอรี่แล้วยังอยู่ต่อ)" : "ตอนนี้ไม่มี OTP ที่เปิดอยู่");
    await interaction.editReply({ embeds: [embed] });
    if (n > 0) await sendLog(interaction.client, "แอดมิน", embeds.adminActionEmbed("🔒 ปิด OTP สตอรี่อุ้ม", `แอดมิน ${interaction.user.tag} ปิด OTP สตอรี่อุ้ม`));
    return;
  }

  if (id === "ap_story_end") {
    const open = await db.getAllOpenStory();
    const otp = await story.activeOtp();
    return interaction.reply({
      embeds: [
        embeds.adminActionEmbed(
          "⚠️ ยืนยันจบสตอรี่อุ้ม",
          `จะ**ปิด OTP** และ**ออกเวลาให้ทุกคน**ที่ยังอยู่ในสตอรี่ (${open.length} คน) นับชั่วโมงถึงตอนนี้${otp ? "" : "\n(ตอนนี้ไม่มี OTP เปิดอยู่)"}`
        ),
      ],
      components: [endConfirmRow()],
      flags: EPHEMERAL,
    });
  }

  if (id === "ap_story_end_cancel") {
    return interaction.update({ embeds: [embeds.adminActionEmbed("ยกเลิกแล้ว", "ไม่มีการจบสตอรี่เกิดขึ้น")], components: [] });
  }

  if (id === "ap_story_end_confirm") {
    await interaction.deferUpdate();
    const res = await story.endStory(interaction.client, interaction.user.tag);
    return interaction.editReply({
      embeds: [embeds.successEmbed(`จบสตอรี่แล้ว — ปิด OTP${res.closedOtp ? "" : " (ไม่มี OTP เปิดอยู่)"} และออกเวลาให้ ${res.cut.length} คน`), res.summary],
      components: [],
    });
  }

  if (id === "ap_story_list") {
    await interaction.deferReply({ flags: EPHEMERAL });
    const open = await db.getAllOpenStory();
    const otp = await story.activeOtp();
    const lines = open.map((r) => `• <@${r.discordId}> (${r.name}) — เข้า ${time.toTz(r.checkIn).format("DD/MM HH:mm")} · ผ่านมา ${time.formatDurationThai(time.hoursBetween(r.checkIn, time.nowIso()))}`);
    const status = otp
      ? `🔓 OTP เปิดอยู่ (รหัส \`${otp.code}\` · หมด <t:${Math.floor(time.toTz(otp.expiresAt).valueOf() / 1000)}:R>)`
      : "🔒 ไม่มี OTP เปิดอยู่";
    let text = lines.join("\n") || "ไม่มีใครอยู่ในสตอรี่";
    if (text.length > 3500) text = text.slice(0, 3490) + "\n…";
    return interaction.editReply({ embeds: [embeds.adminActionEmbed("🎭 คนอยู่ในสตอรี่ตอนนี้", `${status}\n\n**${open.length} คน**\n${text}`)] });
  }

  if (id === "ap_story_summary") {
    await interaction.deferReply({ flags: EPHEMERAL });
    const mondays = new Set([time.now().startOf("isoWeek").format("YYYY-MM-DD")]);
    for (const l of await db.getClosedStoryLogs()) mondays.add(time.toTz(l.checkIn).startOf("isoWeek").format("YYYY-MM-DD"));
    const list = [...mondays].sort().reverse().slice(0, 25);
    const select = new StringSelectMenuBuilder().setCustomId("ap_select_storyweek").setPlaceholder("เลือกสัปดาห์ที่ต้องการดูสรุปเวลาสตอรี่");
    for (const m of list) {
      select.addOptions({ label: time.weekRangeThai(time.toTz(m)), value: m, description: m === list[0] && m === time.now().startOf("isoWeek").format("YYYY-MM-DD") ? "สัปดาห์นี้" : undefined });
    }
    return interaction.editReply({ content: "เลือกสัปดาห์ที่ต้องการดู:", components: [new ActionRowBuilder().addComponents(select)] });
  }
}

async function handleAdminModalSubmit(interaction) {
  if (interaction.customId !== "ap_modal_story_otp") return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const res = await story.openOtp(interaction.user.id, {
    code: interaction.fields.getTextInputValue("code"),
    minutes: interaction.fields.getTextInputValue("minutes"),
  });
  if (!res.ok) return interaction.editReply({ embeds: [embeds.errorEmbed(res.message)] });

  const expUnix = Math.floor(time.toTz(res.otp.expiresAt).valueOf() / 1000);
  await interaction.editReply({
    embeds: [
      embeds.adminActionEmbed(
        "🔑 เปิด OTP สตอรี่อุ้มแล้ว",
        `# \`${res.otp.code}\`\nแจ้งรหัสนี้ให้คนที่จะเข้าสตอรี่ (ข้อความนี้เห็นเฉพาะคุณ)\nเปิดรับเข้า ${res.otp.minutes} นาที — หมด <t:${expUnix}:R> · OTP เก่า (ถ้ามี) ถูกปิดให้แล้ว`
      ),
    ],
  });
  // log ห้องแอดมินไม่ใส่รหัส กันรหัสหลุดให้คนที่ไม่เกี่ยว
  await sendLog(interaction.client, "แอดมิน", embeds.adminActionEmbed("🔑 เปิด OTP สตอรี่อุ้ม", `แอดมิน ${interaction.user.tag} เปิด OTP สตอรี่อุ้ม (เปิดรับ ${res.otp.minutes} นาที)`));
  await story.refreshPanel(interaction.client);
}

async function handleAdminStringSelect(interaction) {
  if (interaction.customId !== "ap_select_storyweek") return;
  await interaction.deferUpdate();
  const ref = time.toTz(interaction.values[0]);
  const { rows, totalCases } = await story.weekRows(ref);
  await interaction.editReply({ content: null, embeds: [story.weekSummaryEmbed(rows, totalCases, ref)], components: [] });
}

module.exports = { handleButton, handleModalSubmit, handleAdminButton, handleAdminModalSubmit, handleAdminStringSelect };
