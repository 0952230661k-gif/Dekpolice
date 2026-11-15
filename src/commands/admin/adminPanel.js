const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const adminPanel = require("../../utils/adminPanel");
const { isAdmin } = require("../../utils/permissions");

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("แผงแอดมิน")
    .setDescription("[แอดมิน] โพสต์แผงควบคุมแอดมิน (รวมทุกฟังก์ชันแอดมินเป็นปุ่ม) — โพสต์ในห้องแอดมินเท่านั้น")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผงแอดมิน (ค่าเริ่มต้น: ห้องนี้)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    // เฉพาะแอดมินจริง (config.adminRoleIds) เท่านั้นที่ "โพสต์" แผงนี้ได้
    // ส่วนการ "ใช้" ปุ่มในแผงหลังโพสต์แล้ว ขึ้นอยู่กับสิทธิ์การมองเห็นห้องนั้นใน Discord (ตั้งค่าให้เฉพาะแอดมินมองเห็นห้องนี้)
    if (!isAdmin(interaction)) {
      return interaction.reply({
        embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannel = interaction.options.getChannel("ห้อง") || interaction.channel;
    await targetChannel.send({
      embeds: [adminPanel.adminPanelEmbed()],
      components: adminPanel.adminPanelRows(),
    });

    await interaction.editReply({
      embeds: [
        embeds.successEmbed(
          `โพสต์แผงควบคุมแอดมินในห้อง <#${targetChannel.id}> เรียบร้อยแล้ว\n` +
            `⚠️ ตรวจสอบให้แน่ใจว่าห้องนี้ตั้งค่าสิทธิ์การมองเห็นไว้เฉพาะแอดมินเท่านั้น เพราะปุ่มในแผงนี้ไม่มีการเช็คยศแอดมินซ้ำ`
        ),
      ],
    });
  },
};
