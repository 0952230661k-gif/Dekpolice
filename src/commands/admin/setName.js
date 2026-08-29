const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const { isAdmin, sendLog } = require("../../utils/permissions");
const { setNickname } = require("../../utils/discordSync");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แก้ไขชื่อ")
    .setDescription("[แอดมิน] เปลี่ยนชื่อในเกมของสมาชิกที่มีอยู่ในระบบ")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการแก้ไขชื่อ (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("ชื่อ").setDescription("ชื่อใหม่ในเกม").setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discordId = interaction.options.getString("ไอดีดิสคอร์ด").trim();
    const newName = interaction.options.getString("ชื่อ").trim();

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    if (!newName) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("กรุณาระบุชื่อใหม่")],
      });
    }

    const existing = await db.findMember(discordId);
    if (!existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ กรุณาเพิ่มสมาชิกด้วยคำสั่ง /สมัคร ก่อน")],
      });
    }

    const oldName = existing.gameName;

    if (oldName === newName) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ชื่อใหม่เหมือนกับชื่อเดิม กรุณาระบุชื่อที่แตกต่างออกไป")],
      });
    }

    await db.updateMemberName(discordId, newName);
    await roster.refreshRoster(interaction.client);

    // เปลี่ยนชื่อเล่นในดิสคอร์ดให้ตรงกับชื่อใหม่
    const nicknameResult = await setNickname(
      interaction,
      discordId,
      embeds.memberNickname({ position: existing.position, gameName: newName })
    );

    const resultLines = [
      `เปลี่ยนชื่อของ ${oldName} (${existing.discordName}) เป็น "${newName}" เรียบร้อยแล้ว`,
    ];
    if (nicknameResult?.ok) {
      resultLines.push(`เปลี่ยนชื่อเล่นเป็น: ${nicknameResult.nickname}`);
    } else if (nicknameResult && !nicknameResult.ok) {
      resultLines.push(`⚠️ เปลี่ยนชื่อเล่นไม่สำเร็จ (${nicknameResult.reason}) กรุณาเปลี่ยนด้วยตนเอง`);
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(resultLines.join("\n"))],
    });

    const logFields = [
      { name: "สมาชิก", value: existing.discordName, inline: true },
      { name: "ชื่อเดิม", value: oldName || "-", inline: true },
      { name: "ชื่อใหม่", value: newName, inline: true },
    ];
    if (nicknameResult?.ok) logFields.push({ name: "เปลี่ยนชื่อเล่น", value: nicknameResult.nickname, inline: false });

    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.adminActionEmbed("✏️ เปลี่ยนชื่อ", `แอดมิน ${interaction.user.tag} เปลี่ยนชื่อสมาชิก`, logFields)
    );

    if (nicknameResult && !nicknameResult.ok) {
      await sendLog(
        interaction.client,
        "แอดมิน",
        embeds.errorEmbed(
          `เปลี่ยนชื่อเล่นให้ <@${discordId}> ตอนแก้ไขชื่อไม่สำเร็จ กรุณาเปลี่ยนด้วยตนเอง (เหตุผล: ${nicknameResult.reason})`
        )
      );
    }
  },
};
