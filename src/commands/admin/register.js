const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const time = require("../../utils/time");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const config = require("../../../config.json");
const { isAdmin, sendLog } = require("../../utils/permissions");

// แจกยศ (Role) ในดิสคอร์ดให้สมาชิกทันทีที่ถูกเพิ่มเข้าระบบ
// อ่านรายชื่อยศจาก config.autoRoleIds (ใส่กี่ยศก็ได้)
async function assignAutoRoles(interaction, discordId) {
  const roleIds = (config.autoRoleIds || []).filter((id) => id && !id.startsWith("ใส่_"));
  if (roleIds.length === 0) return null; // ยังไม่ได้ตั้งค่า ข้ามไปเงียบๆ

  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "สมาชิกไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงแจกยศไม่ได้" };
    }

    const added = [];
    const failed = [];

    for (const roleId of roleIds) {
      try {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          failed.push(`\`${roleId}\` (ไม่พบยศนี้)`);
          continue;
        }
        await member.roles.add(role);
        added.push(`<@&${roleId}>`);
      } catch (err) {
        // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศเป้าหมาย หรือบอทไม่มีสิทธิ์ Manage Roles
        failed.push(`<@&${roleId}> (${err.message})`);
      }
    }

    return { ok: failed.length === 0, added, failed };
  } catch (err) {
    console.error(`แจกยศอัตโนมัติให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

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
      badgeNumber: await db.getNextBadgeNumber(),
      position,
      registeredAt: time.nowIso(),
    };

    await db.addMember(data);
    await roster.refreshRoster(interaction.client);

    const roleResult = await assignAutoRoles(interaction, target.id);

    const resultLines = [`เพิ่มสมาชิก ${target.tag} สำเร็จ! ตอนนี้สามารถใช้คำสั่ง /เข้าเวร ได้แล้ว`];
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
