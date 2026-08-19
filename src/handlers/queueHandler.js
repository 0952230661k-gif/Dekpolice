const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");
const embeds = require("../utils/embeds");
const queue = require("../utils/queue");

const BREAK_MINUTES = { q_break_15: 15, q_break_30: 30, q_break_60: 60 };

function resultReply(result, successMessage) {
  if (result.ok) return { embeds: [embeds.successEmbed(successMessage)] };
  return { embeds: [embeds.errorEmbed(result.reason || "ไม่สามารถดำเนินการนี้ได้")] };
}

async function handleTakeCase(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await queue.takeCase(interaction.user);
  await interaction.editReply(resultReply(result, "รับเคสเรียบร้อยแล้ว ขอให้ปฏิบัติหน้าที่โดยสวัสดิภาพ 🚑"));
}

async function handleEndCase(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await queue.endCase(interaction.user);
  if (!result.ok) {
    return interaction.editReply(resultReply(result));
  }
  await interaction.editReply({
    embeds: [embeds.successEmbed(`จบเคสเรียบร้อยแล้ว (ใช้เวลา ${result.durationMinutes} นาที) กลับเข้าท้ายคิวให้แล้ว`)],
  });
}

async function handleBreakMenu(interaction) {
  await interaction.reply({
    content: "เลือกเวลาที่ต้องการพัก:",
    components: [embeds.queueBreakDurationRow()],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBreakDuration(interaction, minutes) {
  await interaction.deferUpdate();
  const result = await queue.startBreak(interaction.user, minutes);
  if (!result.ok) {
    return interaction.editReply({ content: null, embeds: [embeds.errorEmbed(result.reason)], components: [] });
  }
  await interaction.editReply({
    content: null,
    embeds: [embeds.successEmbed(`เริ่มพัก ${minutes} นาทีแล้ว ระบบจะแจ้งเตือนและนำกลับเข้าคิวให้อัตโนมัติเมื่อหมดเวลา`)],
    components: [],
  });
}

function breakCustomModal() {
  const modal = new ModalBuilder().setCustomId("q_modal_breakcustom").setTitle("กำหนดเวลาพักเอง");
  const minutesInput = new TextInputBuilder()
    .setCustomId("minutes")
    .setLabel("จำนวนนาทีที่ต้องการพัก (1-480)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(minutesInput));
  return modal;
}

async function handleBreakCustomModal(interaction) {
  const raw = interaction.fields.getTextInputValue("minutes").trim();
  const minutes = Number(raw);

  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480 || !Number.isInteger(minutes)) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณาใส่จำนวนนาทีเป็นตัวเลขจำนวนเต็ม ระหว่าง 1-480 นาที")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await queue.startBreak(interaction.user, minutes);
  await interaction.editReply(
    resultReply(result, `เริ่มพัก ${minutes} นาทีแล้ว ระบบจะแจ้งเตือนและนำกลับเข้าคิวให้อัตโนมัติเมื่อหมดเวลา`)
  );
}

async function handleLoop(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await queue.toggleLoop(interaction.user);
  if (!result.ok) return interaction.editReply(resultReply(result));

  const message = result.started
    ? "เริ่มชุบลูปแล้ว จะไม่ถูกเรียกไปรับเคสปกติจนกว่าจะกดหยุดชุบลูป"
    : "หยุดชุบลูปแล้ว กลับเข้าท้ายคิวให้แล้ว";
  await interaction.editReply({ embeds: [embeds.successEmbed(message)] });
}

async function handleReturn(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await queue.returnToQueue(interaction.user);
  await interaction.editReply(resultReply(result, "กลับเข้าท้ายคิวเรียบร้อยแล้ว"));
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === "q_takecase") return handleTakeCase(interaction);
  if (id === "q_endcase") return handleEndCase(interaction);
  if (id === "q_break") return handleBreakMenu(interaction);
  if (id in BREAK_MINUTES) return handleBreakDuration(interaction, BREAK_MINUTES[id]);
  if (id === "q_break_custom") return interaction.showModal(breakCustomModal());
  if (id === "q_loop") return handleLoop(interaction);
  if (id === "q_return") return handleReturn(interaction);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "q_modal_breakcustom") return handleBreakCustomModal(interaction);
}

module.exports = { handleButton, handleModalSubmit };
