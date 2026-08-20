const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");
const { swapPositionRole, setNickname } = require("../../utils/discordSync");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แก้ไขตำแหน่ง")
    .setDescription("[แอดมิน] เปลี่ยนตำแหน่งของสมาชิกที่มีอยู่ในระบบ")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการแก้ไขตำแหน่ง (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) => {
      opt.setName("ตำแหน่ง").setDescription("ตำแหน่งใหม่").setRequired(true);
      for (const pos of config.positions) {
        opt.addChoices({ name: pos, value: pos });
      }
      return opt;
    }),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const discordId = interaction.options.getString("ไอดีดิสคอร์ด").trim();
    const position = interaction.options.getString("ตำแหน่ง");

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    const existing = await db.findMember(discordId);
    if (!existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบสมาชิกไอดีนี้ในระบบ กรุณาเพิ่มสมาชิกด้วยคำสั่ง /สมัคร ก่อน")],
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

    // เปลี่ยนชื่อเล่นในดิสคอร์ดให้ตรงกับตำแหน่งใหม่: "[ตำแหน่ง] ชื่อในเกม"
    const nicknameResult = await setNickname(
      interaction,
      discordId,
      embeds.memberNickname({ position, gameName: existing.gameName })
    );

    const resultLines = [
      `เปลี่ยนตำแหน่งของ ${existing.gameName} (${existing.discordName}) เป็น "${position}" เรียบร้อยแล้ว`,
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
      embeds: [embeds.successEmbed(resultLines.join("\n"))],
    });

    const logFields = [
      { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
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
  },
};
