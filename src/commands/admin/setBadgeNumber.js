const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const db = require("../../utils/db");
const embeds = require("../../utils/embeds");
const roster = require("../../utils/roster");
const { isAdmin, sendLog } = require("../../utils/permissions");
const { setNickname } = require("../../utils/discordSync");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แก้ไขเลขนำหน้า")
    .setDescription("[แอดมิน] แก้ไขเลขนำหน้าของสมาชิก (ปกติออกอัตโนมัติตอนสมัคร ใช้กรณีต้องแก้ไข/แก้เลขชนกัน)")
    .addStringOption((opt) =>
      opt
        .setName("ไอดีดิสคอร์ด")
        .setDescription("Discord ID ของสมาชิกที่ต้องการแก้ไข (ตัวเลขล้วน)")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("เลขนำหน้า").setDescription("เลขนำหน้าใหม่ (ต้องไม่ซ้ำกับคนอื่น)").setRequired(true)
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
    const badgeNumber = interaction.options.getString("เลขนำหน้า").trim();

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

    const holder = await db.findMemberByBadgeNumber(badgeNumber);
    if (holder && holder.discordId !== discordId) {
      return interaction.editReply({
        embeds: [
          embeds.errorEmbed(
            `เลขนำหน้า "${badgeNumber}" ถูกใช้อยู่แล้วโดย ${holder.gameName} (${holder.discordName}) กรุณาใช้เลขอื่น`
          ),
        ],
      });
    }

    await db.updateMemberBadgeNumber(discordId, badgeNumber);
    await roster.refreshRoster(interaction.client);

    // อัปเดตชื่อเล่นในดิสคอร์ดให้ตรงกับเลขนำหน้าใหม่ (คงรูปแบบ "[ตำแหน่ง] ชื่อ" เดิมไว้ ถ้ามีตำแหน่ง)
    const newNickname = existing.position
      ? `[${existing.position}] ${embeds.memberDisplayName({ badgeNumber, gameName: existing.gameName })}`
      : embeds.memberDisplayName({ badgeNumber, gameName: existing.gameName });
    const nicknameResult = await setNickname(interaction, discordId, newNickname);

    const resultLines = [
      `เปลี่ยนเลขนำหน้าของ ${existing.gameName} (${existing.discordName}) เป็น "${badgeNumber}" เรียบร้อยแล้ว`,
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
      { name: "สมาชิก", value: `${existing.gameName} (${existing.discordName})`, inline: true },
      { name: "เลขนำหน้าเดิม", value: existing.badgeNumber || "-", inline: true },
      { name: "เลขนำหน้าใหม่", value: badgeNumber, inline: true },
    ];
    if (nicknameResult?.ok) logFields.push({ name: "เปลี่ยนชื่อเล่น", value: nicknameResult.nickname, inline: false });

    await sendLog(
      interaction.client,
      "แอดมิน",
      embeds.adminActionEmbed("🔢 เปลี่ยนเลขนำหน้า", `แอดมิน ${interaction.user.tag} เปลี่ยนเลขนำหน้าสมาชิก`, logFields)
    );

    if (nicknameResult && !nicknameResult.ok) {
      await sendLog(
        interaction.client,
        "แอดมิน",
        embeds.errorEmbed(
          `เปลี่ยนชื่อเล่นให้ <@${discordId}> ตอนแก้ไขเลขนำหน้าไม่สำเร็จ กรุณาเปลี่ยนด้วยตนเอง (เหตุผล: ${nicknameResult.reason})`
        )
      );
    }
  },
};
