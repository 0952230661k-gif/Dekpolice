const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const db = require("../utils/db");
const time = require("../utils/time");
const embeds = require("../utils/embeds");
const platePanel = require("../utils/platePanel");
const { sendLog } = require("../utils/permissions");

function plateRegisterModal() {
  const modal = new ModalBuilder().setCustomId("plate_modal_register").setTitle("ลงทะเบียนป้ายทะเบียนรถ");

  const plateInput = new TextInputBuilder()
    .setCustomId("plateNumber")
    .setLabel("เลขทะเบียน")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(plateInput));
  return modal;
}

async function handleRegisterModal(interaction) {
  const plateNumber = interaction.fields.getTextInputValue("plateNumber").trim();

  if (!plateNumber) {
    return interaction.reply({
      embeds: [embeds.errorEmbed("กรุณากรอกเลขทะเบียน")],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await db.findMember(interaction.user.id);
  if (!member) {
    return interaction.editReply({
      embeds: [
        embeds.errorEmbed("คุณยังไม่ได้เป็นสมาชิกในระบบ กรุณาติดต่อแอดมินเพื่อเพิ่มชื่อคุณก่อนลงทะเบียนป้ายทะเบียน"),
      ],
    });
  }

  const ownerName = member.gameName;

  const nowIso = time.nowIso();
  const created = await db.addPlate({
    plateNumber,
    ownerName,
    registeredBy: interaction.user.id,
    registeredByName: interaction.user.tag,
    createdAt: nowIso,
  });

  if (!created) {
    const existing = await db.findPlateByNumber(plateNumber);
    return interaction.editReply({
      embeds: [
        embeds.errorEmbed(
          `เลขทะเบียน \`${plateNumber}\` ถูกลงทะเบียนไว้แล้ว (เจ้าของ/ผู้ขับ: ${existing?.ownerName || "-"})`
        ),
      ],
    });
  }

  await platePanel.refreshPlateList(interaction.client);

  await interaction.editReply({
    embeds: [embeds.successEmbed(`ลงทะเบียนป้ายทะเบียน \`${plateNumber}\` (เจ้าของ/ผู้ขับ: ${ownerName}) เรียบร้อยแล้ว`)],
  });

  await sendLog(
    interaction.client,
    "ทะเบียน",
    embeds.adminActionEmbed("🚘 ลงทะเบียนป้ายทะเบียนใหม่", `${interaction.user.tag} ลงทะเบียนป้ายทะเบียนรถ`, [
      { name: "เลขทะเบียน", value: plateNumber, inline: true },
      { name: "เจ้าของ/ผู้ขับ", value: ownerName, inline: true },
    ])
  );
}

async function handleButton(interaction) {
  if (interaction.customId === "plate_register") {
    return interaction.showModal(plateRegisterModal());
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "plate_modal_register") {
    return handleRegisterModal(interaction);
  }
}

module.exports = { handleButton, handleModalSubmit };
