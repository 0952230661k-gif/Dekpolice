const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");
const { setNickname, assignRoles, rolesForNewMember } = require("../../utils/discordSync");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("สมัคร")
    .setDescription("[แอดมิน] เพิ่มสมาชิกเข้าระบบเข้าเวร")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการเพิ่ม (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("ชื่อ").setDescription("ชื่อของสมาชิก").setRequired(true)
    )
    .addStringOption((opt) => {
      opt.setName("ตำแหน่ง").setDescription("ตำแหน่งของสมาชิก").setRequired(true);
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
    const gameName = interaction.options.getString("ชื่อ");
    const position = interaction.options.getString("ตำแหน่ง");

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไอดีดิสคอร์ดไม่ถูกต้อง กรุณาใส่เฉพาะตัวเลข (17-20 หลัก)")],
      });
    }

    let target;
    try {
      target = await interaction.client.users.fetch(discordId);
    } catch {
      return interaction.editReply({
        embeds: [embeds.errorEmbed("ไม่พบผู้ใช้ Discord ที่ไอดีนี้ กรุณาตรวจสอบไอดีอีกครั้ง")],
      });
    }

    const existing = await db.findMember(target.id);
    if (existing) {
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`${target.tag} มีอยู่ในระบบแล้ว ไม่สามารถเพิ่มซ้ำได้`)],
      });
    }

    const data = {
      discordId: target.id,
      discordName: target.tag,
      gameName,
      position,
      registeredAt: time.nowIso(),
    };

    data.badgeNumber = await db.addMember(data);
    await roster.refreshRoster(interaction.client);

    // ตั้งชื่อเล่นในดิสคอร์ด: #เลขประจำตัว [ตำแหน่ง] ชื่อ
    const nicknameResult = await setNickname(interaction, target.id, embeds.memberNickname(data));

    // แจกยศพื้นฐาน (autoRoleIds) + ยศของตำแหน่งที่เลือก (positionRoleIds) ทันที
    const roleResult = await assignRoles(
      interaction,
      target.id,
      rolesForNewMember(position, config.autoRoleIds, config.positionRoleIds)
    );

    const resultLines = [`เพิ่มสมาชิก ${target.tag} สำเร็จ! เลขประจำตัว ${embeds.formatBadge(data.badgeNumber)} ตอนนี้สามารถใช้คำสั่ง /เข้าเวร ได้แล้ว`];
    if (nicknameResult?.ok) resultLines.push(`ตั้งชื่อเล่นเป็น: ${nicknameResult.nickname}`);
    else if (nicknameResult) resultLines.push(`⚠️ ตั้งชื่อเล่นไม่สำเร็จ (${nicknameResult.reason}) กรุณาเปลี่ยนด้วยตนเอง`);
    if (roleResult?.added?.length) {
      resultLines.push(`แจกยศสำเร็จ: ${roleResult.added.join(" ")}`);
    }
    if (roleResult && !roleResult.ok) {
      resultLines.push(
        `⚠️ แจกยศไม่สำเร็จบางส่วน/ทั้งหมด (${roleResult.reason || roleResult.failed?.join(", ")}) กรุณาแจกยศด้วยตนเอง`
      );
    }

    await interaction.editReply({
      embeds: [embeds.successEmbed(resultLines.join("\n"))],
    });

    await sendLog(
      interaction.client,
      "สมัคร",
      embeds.registerEmbed({ ...data, addedBy: interaction.user.tag })
    );

    if (roleResult && !roleResult.ok) {
      await sendLog(
        interaction.client,
        "แอดมิน",
        embeds.errorEmbed(
          `แจกยศอัตโนมัติให้ <@${target.id}> ไม่สำเร็จบางส่วน/ทั้งหมด กรุณาแจกยศด้วยตนเอง (เหตุผล: ${
            roleResult.reason || roleResult.failed?.join(", ")
          })`
        )
      );
    }
  },
};
