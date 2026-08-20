const dayjs = require("dayjs");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const roster = require("../utils/roster");
const panel = require("../utils/panel");
const weeklyReset = require("../utils/weeklyReset");
const config = require("../../config.json");
const { sendLog, isAdmin } = require("../utils/permissions");
const { swapPositionRole, setNickname, assignRoles } = require("../utils/discordSync");

// เก็บสถานะชั่วคราวระหว่างขั้นตอนหลายสเต็ป (เฉพาะ "เพิ่มสมาชิก" และ "แก้ไขตำแหน่ง" ที่ต้องเลือกตำแหน่งต่อจาก modal)
// key = discord user id ของแอดมินที่กำลังทำรายการ, จะถูกลบทิ้งทันทีที่ใช้เสร็จ
const pendingRegister = new Map(); // adminId -> { discordId, discordTag, gameName }
const pendingSetPosition = new Map(); // adminId -> discordId
const pendingRemoveMember = new Map(); // adminId -> discordId (รอยืนยันก่อนลบจริง)

// ---------- Helper: เช็คสิทธิ์แอดมินก่อนให้ใช้งานทุกปุ่ม/เมนู/modal ในแผงควบคุมแอดมิน ----------
// คืนค่า true ถ้า "ไม่ใช่" แอดมิน (และได้ตอบ interaction แจ้งเตือนไปแล้ว) — ใช้ return early ที่ตัวเรียก
async function blockIfNotAdmin(interaction) {
  if (isAdmin(interaction)) return false;

  const denyReply = {
    embeds: [embeds.errorEmbed("คุณไม่มีสิทธิ์ใช้งานแผงควบคุมแอดมิน")],
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction.isModalSubmit() || interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(denyReply);
      } else {
        await interaction.reply(denyReply);
      }
    }
  } catch (err) {
    console.error("แจ้งเตือนสิทธิ์แอดมินไม่สำเร็จ:", err.message);
  }

  return true;
}

// ---------- Helper: ตัวเลือกตำแหน่งแบบ select menu ----------
function positionSelectRow(customId) {
  const select = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("เลือกตำแหน่ง");
  for (const pos of config.positions) {
    select.addOptions({ label: pos, value: pos });
  }
  return new ActionRowBuilder().addComponents(select);
}

function userSelectRow(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
  );
}

// ---------- ปุ่ม: ข้อมูล (ไม่ต้องขอข้อมูลเพิ่ม) ----------

async function handleOnDuty(interaction) {
  await interaction.deferReply();
  const openList = await db.getAllOpenDuty();
  if (openList.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed("🟢 คนเข้าเวรตอนนี้", "ไม่มีใครกำลังเข้าเวรอยู่")],
    });
  }
  const fields = openList.map((r) => ({ name: r.name, value: `เข้าเวรเมื่อ: ${time.displayDateTime(r.checkIn)}` }));
  await interaction.editReply({
    embeds: [embeds.adminActionEmbed("🟢 คนเข้าเวรตอนนี้", `รวม ${openList.length} คน`, fields)],
  });
}

async function handleSummary(interaction) {
  await interaction.deferReply();

  const allLogs = await db.getDutyLogs();
  const byMember = {};
  for (const log of allLogs) {
    if (!byMember[log.discordId]) byMember[log.discordId] = [];
    byMember[log.discordId].push(log);
  }

  const rows = [];
  for (const [discordId, logs] of Object.entries(byMember)) {
    const summary = time.summarizeLogs(logs);
    if (summary.hoursWeek === 0 && summary.dutyCount === 0) continue;
    const name = logs[0]?.name || discordId;

    await db.writeSummaryRow({
      discordId,
      name,
      hoursToday: summary.hoursToday,
      hoursWeek: summary.hoursWeek,
      hoursMonth: summary.hoursMonth,
      dutyCount: summary.dutyCount,
      updatedAt: time.nowIso(),
    });

    rows.push({ name, ...summary });
  }

  if (rows.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed(`📊 สรุปสัปดาห์นี้ (${time.weekRangeThai()})`, "ยังไม่มีข้อมูลการเข้าเวรในสัปดาห์นี้")],
    });
  }

  rows.sort((a, b) => b.hoursWeek - a.hoursWeek);
  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  await interaction.editReply({
    embeds: [
      embeds.adminActionEmbed(
        `📊 สรุปสัปดาห์นี้ (${time.weekRangeThai()})`,
        `อัปเดตข้อมูลลงฐานข้อมูล Summary แล้ว (${rows.length} คน) — ยอดสัปดาห์นี้จะไม่ถูกรีเซ็ตเองอัตโนมัติ ต้องสั่งเคลียร์ฐานข้อมูลรายสัปดาห์เอง (🧹) เมื่อจบรอบ`,
        fields
      ),
    ],
  });
}

async function handleExport(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { members, dutyLog, summary } = await db.exportAllCsv();
  const files = [
    new AttachmentBuilder(Buffer.from(members, "utf-8"), { name: "members.csv" }),
    new AttachmentBuilder(Buffer.from(dutyLog, "utf-8"), { name: "duty_log.csv" }),
    new AttachmentBuilder(Buffer.from(summary, "utf-8"), { name: "summary.csv" }),
  ];
  await interaction.editReply({
    embeds: [embeds.successEmbed("ส่งออกข้อมูลทั้ง 3 ตารางเรียบร้อยแล้ว (แนบไฟล์ด้านล่าง)")],
    files,
  });
}

async function handlePostDutyPanel(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await panel.postPanel(interaction.channel);
  await interaction.editReply({
    embeds: [embeds.successEmbed("โพสต์แผงเข้าเวรในห้องนี้เรียบร้อยแล้ว")],
  });
}

async function handlePostRoster(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await roster.postRoster(interaction.channel);
  } catch (err) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed(`โพสต์รายชื่อไม่สำเร็จ: ${err.message || "ไม่ทราบสาเหตุ"}`)],
    });
  }
  await interaction.editReply({ embeds: [embeds.successEmbed("โพสต์รายชื่อในห้องนี้เรียบร้อยแล้ว")] });
}

// ขั้นแรก: แค่แจ้งเตือน + ให้กดยืนยันก่อน เพราะปุ่มนี้จะ "ลบ" ข้อมูลเวรที่ปิดรายการแล้วออกจากฐานข้อมูลจริง
async function handleRunWeekly(interaction) {
  await interaction.reply({
    embeds: [
      embeds.adminActionEmbed(
        "⚠️ ยืนยันเคลียร์ฐานข้อมูลรายสัปดาห์",
        "การกดยืนยันจะสรุปยอดชั่วโมงเวรที่ค้างอยู่ตอนนี้ บันทึกลงประวัติ แล้ว**ลบ**ข้อมูลเวรที่ปิดรายการแล้วออกจาก duty_log จริง " +
          "(ย้อนกลับไม่ได้ — ยังดูสรุปย้อนหลังได้ผ่าน /ประวัติสัปดาห์) แถวที่ยังเข้าเวรค้างอยู่จะไม่ถูกลบ"
      ),
    ],
    components: [runWeeklyConfirmRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRunWeeklyConfirm(interaction) {
  await interaction.deferUpdate();
  const { weekKey, rows, embed, clearedCount } = await weeklyReset.runNow(interaction.client);
  await interaction.editReply({
    embeds: [
      embeds.successEmbed(
        `สั่งเคลียร์ฐานข้อมูลรายสัปดาห์ (${time.weekRangeThaiFromKey(weekKey)}) เรียบร้อยแล้ว (${rows.length} คนมีข้อมูลสะสม, ลบ ${clearedCount} แถวออกจากระบบ) — บันทึกลงประวัติแล้ว`
      ),
      embed,
    ],
    components: [],
  });
}

async function handleRunWeeklyCancel(interaction) {
  await interaction.update({
    embeds: [embeds.adminActionEmbed("ยกเลิกแล้ว", "ไม่มีการเคลียร์ฐานข้อมูลเกิดขึ้น")],
    components: [],
  });
}

async function handleWeeklyHistoryList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const weeks = await db.listWeeklyHistoryWeeks(25);

  if (weeks.length === 0) {
    return interaction.editReply({
      embeds: [embeds.adminActionEmbed("📜 ประวัติสัปดาห์ก่อนหน้า", "ยังไม่มีประวัติที่บันทึกไว้")],
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId("ap_select_weeklyhistory")
    .setPlaceholder("เลือกสัปดาห์ที่ต้องการดู")
    .addOptions(
      weeks.map((w) => ({
        label: `${w.weekKey} • ${time.weekRangeThaiFromKey(w.weekKey)}`,
        description: `${time.formatDurationThai(w.totalHours)} รวม / ${w.memberCount} คน`,
        value: w.weekKey,
      }))
    );

  await interaction.editReply({
    content: "เลือกสัปดาห์ที่ต้องการดูรายละเอียด:",
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

// ---------- ปุ่ม: ต้องเลือกสมาชิกก่อน (เปิด user select menu) ----------

const USER_SELECT_META = {
  ap_addhours: { customId: "ap_select_addhours", placeholder: "เลือกสมาชิกที่จะเพิ่มชั่วโมง" },
  ap_subhours: { customId: "ap_select_subhours", placeholder: "เลือกสมาชิกที่จะลดชั่วโมง" },
  ap_edittime: { customId: "ap_select_edittime", placeholder: "เลือกสมาชิกที่จะแก้เวลา" },
  ap_clearduty: { customId: "ap_select_clearduty", placeholder: "เลือกสมาชิกที่จะล้างสถานะเวร" },
  ap_setposition: { customId: "ap_select_setposition_user", placeholder: "เลือกสมาชิกที่จะแก้ไขตำแหน่ง" },
  ap_removemember: { customId: "ap_select_removemember_user", placeholder: "เลือกสมาชิกที่จะลบ" },
  ap_register: { customId: "ap_select_register_user", placeholder: "เลือกสมาชิกที่จะเพิ่ม" },
};

async function handleAskUser(interaction, buttonId) {
  const meta = USER_SELECT_META[buttonId];
  await interaction.reply({
    content: "เลือกสมาชิกจากเมนูด้านล่าง:",
    components: [userSelectRow(meta.customId, meta.placeholder)],
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- ปุ่ม: เปิด modal ทันที ----------

function registerModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_register:${targetId}`).setTitle("เพิ่มสมาชิกใหม่");
  const nameInput = new TextInputBuilder()
    .setCustomId("gameName")
    .setLabel("ชื่อสมาชิก")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
  return modal;
}

function removeMemberConfirmRow(discordId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ap_removemember_confirm:${discordId}`)
      .setLabel("ยืนยันลบ")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ap_removemember_cancel")
      .setLabel("ยกเลิก")
      .setStyle(ButtonStyle.Secondary)
  );
}

function runWeeklyConfirmRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ap_runweekly_confirm")
      .setLabel("ยืนยันเคลียร์ฐานข้อมูล")
      .setEmoji("🧹")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ap_runweekly_cancel")
      .setLabel("ยกเลิก")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ---------- ปุ่มหลัก ----------

async function handleButton(interaction) {
  if (await blockIfNotAdmin(interaction)) return;

  const id = interaction.customId;

  if (id === "ap_onduty") return handleOnDuty(interaction);
  if (id === "ap_summary") return handleSummary(interaction);
  if (id === "ap_export") return handleExport(interaction);
  if (id === "ap_postdutypanel") return handlePostDutyPanel(interaction);
  if (id === "ap_postroster") return handlePostRoster(interaction);
  if (id in USER_SELECT_META) return handleAskUser(interaction, id);
  if (id.startsWith("ap_removemember_confirm:")) return handleRemoveMemberConfirm(interaction, id.split(":")[1]);
  if (id === "ap_removemember_cancel") return handleRemoveMemberCancel(interaction);
  if (id === "ap_runweekly") return handleRunWeekly(interaction);
  if (id === "ap_runweekly_confirm") return handleRunWeeklyConfirm(interaction);
  if (id === "ap_runweekly_cancel") return handleRunWeeklyCancel(interaction);
  if (id === "ap_weeklyhistory") return handleWeeklyHistoryList(interaction);
}

// ---------- User select menu (ขั้นตอนที่ 2 ของ เพิ่ม/ลดชั่วโมง, แก้เวลา, ล้างสถานะเวร) ----------

function addHoursModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_addhours:${targetId}`).setTitle("เพิ่มชั่วโมงเวร");
  const hoursInput = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel("จำนวนชั่วโมงที่ต้องการเพิ่ม")
    .setPlaceholder("เช่น 2.5")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผล (ถ้ามี)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(hoursInput), new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function subHoursModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_subhours:${targetId}`).setTitle("ลดชั่วโมงเวร");
  const hoursInput = new TextInputBuilder()
    .setCustomId("hours")
    .setLabel("จำนวนชั่วโมงที่ต้องการลด")
    .setPlaceholder("เช่น 1")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const reasonInput = new TextInputBuilder()
    .setCustomId("reason")
    .setLabel("เหตุผล (ถ้ามี)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(hoursInput), new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

function editTimeModal(targetId) {
  const modal = new ModalBuilder().setCustomId(`ap_modal_edittime:${targetId}`).setTitle("แก้เวลาเข้า/ออกเวร");
  const dateInput = new TextInputBuilder()
    .setCustomId("date")
    .setLabel("วันที่ของรายการเวร (YYYY-MM-DD)")
    .setPlaceholder("เช่น 2026-07-29")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const checkInInput = new TextInputBuilder()
    .setCustomId("checkIn")
    .setLabel("เวลาเข้าใหม่ (HH:mm)")
    .setPlaceholder("เช่น 20:00")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  const checkOutInput = new TextInputBuilder()
    .setCustomId("checkOut")
    .setLabel("เวลาออกใหม่ (HH:mm) เว้นว่างได้ถ้ายังไม่ออกเวร")
    .setPlaceholder("เช่น 23:30")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(
    new ActionRowBuilder().addComponents(dateInput),
    new ActionRowBuilder().addComponents(checkInInput),
    new ActionRowBuilder().addComponents(checkOutInput)
  );
  return modal;
}

async function handleSelectClearDuty(interaction) {
  const targetId = interaction.values[0];
  await interaction.deferUpdate();

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  const cleared = await db.clearDutyStatus(targetId);

  if (!cleared) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed(`${target?.tag || targetId} ไม่มีสถานะเข้าเวรค้างอยู่`)],
      components: [],
    });
  }

  const embed = embeds.adminActionEmbed("🧹 ล้างสถานะเข้าเวร", `ล้างสถานะเข้าเวรของ ${target?.tag || targetId} เรียบร้อย`, [
    { name: "ดำเนินการโดย", value: interaction.user.tag },
  ]);

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
  await sendLog(interaction.client, "แอดมิน", embed);
  await panel.refreshPanel(interaction.client);
}

async function handleUserSelect(interaction) {
  if (await blockIfNotAdmin(interaction)) return;

  const id = interaction.customId;
  const targetId = interaction.values[0];

  if (id === "ap_select_addhours") return interaction.showModal(addHoursModal(targetId));
  if (id === "ap_select_subhours") return interaction.showModal(subHoursModal(targetId));
  if (id === "ap_select_edittime") return interaction.showModal(editTimeModal(targetId));
  if (id === "ap_select_clearduty") return handleSelectClearDuty(interaction);
  if (id === "ap_select_register_user") return interaction.showModal(registerModal(targetId));
  if (id === "ap_select_setposition_user") return handleSelectMemberForSetPosition(interaction, targetId);
  if (id === "ap_select_removemember_user") return handleSelectMemberForRemoveMember(interaction, targetId);
}

// ---------- เลือกสมาชิกจากเมนู (ขั้นตอนที่ 1 ของ "แก้ไขตำแหน่ง" / "ลบสมาชิก") ----------

async function handleSelectMemberForSetPosition(interaction, discordId) {
  await interaction.deferUpdate();

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ กรุณาเพิ่มสมาชิกด้วยปุ่ม \"เพิ่มสมาชิก\" ก่อน")],
      components: [],
    });
  }

  pendingSetPosition.set(interaction.user.id, discordId);

  await interaction.editReply({
    content: `เลือกตำแหน่งใหม่ของ **${existing.gameName}** (${existing.discordId}):`,
    embeds: [],
    components: [positionSelectRow("ap_select_setposition")],
  });
}

async function handleSelectMemberForRemoveMember(interaction, discordId) {
  await interaction.deferUpdate();

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ")],
      components: [],
    });
  }

  pendingRemoveMember.set(interaction.user.id, discordId);

  await interaction.editReply({
    content: null,
    embeds: [
      embeds.adminActionEmbed(
        "⚠️ ยืนยันการลบสมาชิก",
        `ต้องการลบ **${existing.gameName}** (${existing.discordId}) ออกจากรายชื่อใช่หรือไม่?\nประวัติการเข้าเวรเดิมจะยังคงอยู่ แต่จะไม่สามารถเข้าเวรได้อีกจนกว่าจะสมัครใหม่`,
        [{ name: "ตำแหน่งปัจจุบัน", value: existing.position || "-", inline: true }]
      ),
    ],
    components: [removeMemberConfirmRow(discordId)],
  });
}

// ---------- String select menu (ขั้นตอนเลือกตำแหน่งของ "เพิ่มสมาชิก" / "แก้ไขตำแหน่ง") ----------

async function handleSelectRegPosition(interaction) {
  const pending = pendingRegister.get(interaction.user.id);
  if (!pending) {
    return interaction.update({ content: "หมดเวลาการเพิ่มสมาชิก กรุณากดปุ่ม \"เพิ่มสมาชิก\" ใหม่อีกครั้ง", components: [] });
  }
  pendingRegister.delete(interaction.user.id);
  const position = interaction.values[0];
  await interaction.deferUpdate();

  const data = {
    discordId: pending.discordId,
    discordName: pending.discordTag,
    gameName: pending.gameName,
    badgeNumber: await db.getNextBadgeNumber(),
    position,
    registeredAt: time.nowIso(),
  };

  await db.addMember(data);
  await roster.refreshRoster(interaction.client);

  // แจกยศเริ่มต้น (config.autoRoleIds) ให้สมาชิกใหม่ทันที
  const roleResult = await assignRoles(interaction, pending.discordId, config.autoRoleIds);

  const resultLines = [`เพิ่มสมาชิก ${pending.discordTag} สำเร็จ! ตอนนี้สามารถกดปุ่ม "เข้าเวร" ได้แล้ว`];
  if (roleResult?.added?.length) {
    resultLines.push(`แจกยศสำเร็จ: ${roleResult.added.join(" ")}`);
  }
  if (roleResult && !roleResult.ok) {
    resultLines.push(
      `⚠️ แจกยศไม่สำเร็จบางส่วน/ทั้งหมด (${roleResult.reason || roleResult.failed?.join(", ")}) กรุณาแจกยศด้วยตนเอง`
    );
  }

  await interaction.editReply({
    content: null,
    embeds: [embeds.successEmbed(resultLines.join("\n"))],
    components: [],
  });

  await sendLog(interaction.client, "สมัคร", embeds.registerEmbed({ ...data, addedBy: interaction.user.tag }));

  if (roleResult && !roleResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `แจกยศอัตโนมัติให้ <@${pending.discordId}> ตอนเพิ่มสมาชิกไม่สำเร็จบางส่วน/ทั้งหมด กรุณาแจกยศด้วยตนเอง (เหตุผล: ${
          roleResult.reason || roleResult.failed?.join(", ")
        })`
      )
    );
  }
}

async function handleSelectSetPosition(interaction) {
  const discordId = pendingSetPosition.get(interaction.user.id);
  if (!discordId) {
    return interaction.update({ content: "หมดเวลาการแก้ไขตำแหน่ง กรุณากดปุ่ม \"แก้ไขตำแหน่ง\" ใหม่อีกครั้ง", components: [] });
  }
  pendingSetPosition.delete(interaction.user.id);
  const position = interaction.values[0];
  await interaction.deferUpdate();

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบแล้ว (อาจถูกลบไปก่อนหน้านี้)")],
      components: [],
    });
  }

  await db.updateMemberPosition(discordId, position);
  await roster.refreshRoster(interaction.client);

  // ถอดยศตำแหน่งเก่า + ใส่ยศตำแหน่งใหม่ ตาม config.positionRoleIds
  const roleResult = await swapPositionRole(
    interaction,
    discordId,
    existing.position,
    position,
    config.positionRoleIds
  );

  // เปลี่ยนชื่อเล่นในดิสคอร์ดให้ตรงกับตำแหน่งใหม่: "เลขนำหน้า [ตำแหน่ง] ชื่อในเกม" (เลขนำหน้าอยู่หน้าสุด ก่อนยศ)
  const nicknameResult = await setNickname(
    interaction,
    discordId,
    embeds.memberNickname({ badgeNumber: existing.badgeNumber, position, gameName: existing.gameName })
  );

  const resultLines = [
    `เปลี่ยนตำแหน่งของ ${existing.gameName} (${existing.discordId}) เป็น "${position}" เรียบร้อยแล้ว`,
  ];
  if (roleResult?.removed?.length || roleResult?.added?.length) {
    const parts = [];
    if (roleResult.removed.length) parts.push(`ถอด ${roleResult.removed.join(" ")}`);
    if (roleResult.added.length) parts.push(`ใส่ ${roleResult.added.join(" ")}`);
    resultLines.push(parts.join(" / "));
  }
  if (roleResult && !roleResult.ok) {
    resultLines.push(
      `⚠️ เปลี่ยนยศไม่สำเร็จบางส่วน/ทั้งหมด (${roleResult.reason || roleResult.failed?.join(", ")}) กรุณาแก้ยศด้วยตนเอง`
    );
  }
  if (nicknameResult?.ok) {
    resultLines.push(`เปลี่ยนชื่อเล่นเป็น: ${nicknameResult.nickname}`);
  } else if (nicknameResult && !nicknameResult.ok) {
    resultLines.push(`⚠️ เปลี่ยนชื่อเล่นไม่สำเร็จ (${nicknameResult.reason}) กรุณาเปลี่ยนด้วยตนเอง`);
  }

  await interaction.editReply({
    content: null,
    embeds: [embeds.successEmbed(resultLines.join("\n"))],
    components: [],
  });

  const logFields = [
    { name: "สมาชิก", value: `${existing.gameName} (${existing.discordId})`, inline: true },
    { name: "ตำแหน่งเดิม", value: existing.position || "-", inline: true },
    { name: "ตำแหน่งใหม่", value: position, inline: true },
  ];
  if (roleResult?.removed?.length) logFields.push({ name: "ถอดยศ", value: roleResult.removed.join(" "), inline: false });
  if (roleResult?.added?.length) logFields.push({ name: "ใส่ยศ", value: roleResult.added.join(" "), inline: false });
  if (nicknameResult?.ok) logFields.push({ name: "เปลี่ยนชื่อเล่น", value: nicknameResult.nickname, inline: false });

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed("🎖️ เปลี่ยนตำแหน่ง", `แอดมิน ${interaction.user.tag} เปลี่ยนตำแหน่งสมาชิก`, logFields)
  );

  if (roleResult && !roleResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `เปลี่ยนยศอัตโนมัติให้ <@${discordId}> ตอนแก้ไขตำแหน่งไม่สำเร็จบางส่วน/ทั้งหมด กรุณาแก้ยศด้วยตนเอง (เหตุผล: ${
          roleResult.reason || roleResult.failed?.join(", ")
        })`
      )
    );
  }
  if (nicknameResult && !nicknameResult.ok) {
    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.errorEmbed(
        `เปลี่ยนชื่อเล่นให้ <@${discordId}> ตอนแก้ไขตำแหน่งไม่สำเร็จ กรุณาเปลี่ยนด้วยตนเอง (เหตุผล: ${nicknameResult.reason})`
      )
    );
  }
}

async function handleSelectWeeklyHistory(interaction) {
  const weekKey = interaction.values[0];
  await interaction.deferUpdate();

  const rows = await db.getWeeklyHistory(weekKey);
  if (rows.length === 0) {
    return interaction.editReply({
      content: null,
      embeds: [embeds.errorEmbed(`ไม่พบข้อมูลของสัปดาห์ ${weekKey}`)],
      components: [],
    });
  }

  const fields = rows.slice(0, 25).map((r) => ({
    name: r.name,
    value: `${time.formatDurationThai(r.hoursWeek)} (${r.dutyCount} ครั้ง)`,
    inline: true,
  }));

  const embed = embeds.adminActionEmbed(
    `📜 สรุปสัปดาห์ ${time.weekRangeThaiFromKey(weekKey)}`,
    `รวม ${rows.length} คนที่มีข้อมูลในสัปดาห์นี้`,
    fields
  );

  await interaction.editReply({ content: null, embeds: [embed], components: [] });
}

async function handleStringSelect(interaction) {
  if (await blockIfNotAdmin(interaction)) return;

  const id = interaction.customId;
  if (id === "ap_select_regposition") return handleSelectRegPosition(interaction);
  if (id === "ap_select_setposition") return handleSelectSetPosition(interaction);
  if (id === "ap_select_weeklyhistory") return handleSelectWeeklyHistory(interaction);
}

// ---------- Modal submit ----------

async function handleModalAddHours(interaction, targetId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amount = parseFloat(interaction.fields.getTextInputValue("hours"));
  const reason = interaction.fields.getTextInputValue("reason");

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("จำนวนชั่วโมงต้องเป็นตัวเลขมากกว่า 0")] });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const member = await db.findMember(target.id);
  if (!member) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} ยังไม่ได้สมัครสมาชิกในระบบ`)] });
  }

  await db.addManualAdjustment(target.id, member.gameName, amount, reason, time.todayStr());

  const embed = embeds.adminActionEmbed("➕ เพิ่มชั่วโมงเวร", `เพิ่ม ${amount} ชั่วโมงให้ ${target.tag}`, [
    { name: "เหตุผล", value: reason || "-", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag, inline: true },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalSubHours(interaction, targetId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amount = parseFloat(interaction.fields.getTextInputValue("hours"));
  const reason = interaction.fields.getTextInputValue("reason");

  if (!Number.isFinite(amount) || amount <= 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("จำนวนชั่วโมงต้องเป็นตัวเลขมากกว่า 0")] });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const member = await db.findMember(target.id);
  if (!member) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} ยังไม่ได้สมัครสมาชิกในระบบ`)] });
  }

  await db.addManualAdjustment(target.id, member.gameName, -amount, reason, time.todayStr());

  const embed = embeds.adminActionEmbed("➖ ลดชั่วโมงเวร", `ลด ${amount} ชั่วโมงจาก ${target.tag}`, [
    { name: "เหตุผล", value: reason || "-", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag, inline: true },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalEditTime(interaction, targetId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const dateStr = interaction.fields.getTextInputValue("date").trim();
  const checkInStr = interaction.fields.getTextInputValue("checkIn").trim();
  const checkOutStr = interaction.fields.getTextInputValue("checkOut").trim();

  if (!dayjs(dateStr, "YYYY-MM-DD", true).isValid()) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("รูปแบบวันที่ไม่ถูกต้อง ใช้รูปแบบ YYYY-MM-DD เช่น 2026-07-29")],
    });
  }

  const target = await interaction.client.users.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้")] });
  }

  const logs = await db.getDutyLogs(target.id);
  const matches = logs.filter((r) => r.date === dateStr);
  if (matches.length === 0) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`ไม่พบรายการเวรของ ${target.tag} ในวันที่ ${dateStr}`)] });
  }
  const targetRow = matches[matches.length - 1];

  const newCheckIn = dayjs.tz(`${dateStr} ${checkInStr}`, "YYYY-MM-DD HH:mm", time.TZ).toISOString();
  let newCheckOut = null;
  let hours = targetRow.hours;

  if (checkOutStr) {
    let checkOutDate = dayjs.tz(`${dateStr} ${checkOutStr}`, "YYYY-MM-DD HH:mm", time.TZ);
    if (checkOutDate.isBefore(dayjs(newCheckIn))) {
      checkOutDate = checkOutDate.add(1, "day");
    }
    newCheckOut = checkOutDate.toISOString();
    hours = time.hoursBetween(newCheckIn, newCheckOut);
  }

  await db.editDutyTime(targetRow._rowNumber, newCheckIn, newCheckOut, hours);

  const embed = embeds.adminActionEmbed("✏️ แก้ไขเวลาเวร", `แก้ไขรายการเวรของ ${target.tag} วันที่ ${dateStr}`, [
    { name: "เวลาเข้าใหม่", value: time.displayDateTime(newCheckIn), inline: true },
    { name: "เวลาออกใหม่", value: newCheckOut ? time.displayDateTime(newCheckOut) : "ไม่เปลี่ยนแปลง", inline: true },
    { name: "ดำเนินการโดย", value: interaction.user.tag },
  ]);

  await interaction.editReply({ embeds: [embed] });
  await sendLog(interaction.client, "แอดมิน", embed);
}

async function handleModalRegister(interaction, targetId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const gameName = interaction.fields.getTextInputValue("gameName").trim();

  let target;
  try {
    target = await interaction.client.users.fetch(targetId);
  } catch {
    return interaction.editReply({ embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord รายนี้ กรุณาลองใหม่อีกครั้ง")] });
  }

  const existing = await db.findMember(target.id);
  if (existing) {
    return interaction.editReply({ embeds: [embeds.errorEmbed(`${target.tag} มีอยู่ในระบบแล้ว ไม่สามารถเพิ่มซ้ำได้`)] });
  }

  pendingRegister.set(interaction.user.id, { discordId: target.id, discordTag: target.tag, gameName });

  await interaction.editReply({
    content: `เลือกตำแหน่งของ **${gameName}** (${target.tag}):`,
    components: [positionSelectRow("ap_select_regposition")],
  });
}

// ---------- ปุ่มยืนยัน/ยกเลิก การลบสมาชิก ----------

async function handleRemoveMemberConfirm(interaction, discordId) {
  const pending = pendingRemoveMember.get(interaction.user.id);
  if (!pending || pending !== discordId) {
    return interaction.update({
      content: "หมดเวลาการลบสมาชิก กรุณากดปุ่ม \"ลบสมาชิก\" ใหม่อีกครั้ง",
      embeds: [],
      components: [],
    });
  }
  pendingRemoveMember.delete(interaction.user.id);
  await interaction.deferUpdate();

  const existing = await db.findMember(discordId);
  if (!existing) {
    return interaction.editReply({
      embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบแล้ว (อาจถูกลบไปก่อนหน้านี้)")],
      components: [],
    });
  }

  await db.removeMember(discordId);
  await roster.refreshRoster(interaction.client);

  const embed = embeds.successEmbed(`ลบสมาชิก ${existing.gameName} (${existing.discordId}) ออกจากระบบเรียบร้อยแล้ว`);

  await interaction.editReply({ embeds: [embed], components: [] });

  await sendLog(
    interaction.client,
    "แอดมิน",
    embeds.adminActionEmbed("🗑️ ลบสมาชิก", `แอดมิน ${interaction.user.tag} ลบสมาชิกออกจากระบบ`, [
      { name: "สมาชิก", value: `${existing.gameName} (${existing.discordId})`, inline: true },
      { name: "ตำแหน่งเดิม", value: existing.position || "-", inline: true },
    ])
  );
}

async function handleRemoveMemberCancel(interaction) {
  pendingRemoveMember.delete(interaction.user.id);
  await interaction.update({
    embeds: [embeds.adminActionEmbed("ยกเลิกแล้ว", "ไม่มีการลบสมาชิกเกิดขึ้น")],
    components: [],
  });
}

async function handleModalSubmit(interaction) {
  if (await blockIfNotAdmin(interaction)) return;

  const [action, targetId] = interaction.customId.split(":");

  if (action === "ap_modal_addhours") return handleModalAddHours(interaction, targetId);
  if (action === "ap_modal_subhours") return handleModalSubHours(interaction, targetId);
  if (action === "ap_modal_edittime") return handleModalEditTime(interaction, targetId);
  if (action === "ap_modal_register") return handleModalRegister(interaction, targetId);
}

module.exports = {
  handleButton,
  handleUserSelect,
  handleStringSelect,
  handleModalSubmit,
};
