const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");
const config = require("../../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("แผงเคส")
    .setDescription("โพสต์แผงระบบส่งเคส (Case Report) พร้อมปุ่มดูข้อมูล/อันดับ (แอดมินเท่านั้น)")
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผง (ค่าเริ่มต้น: ห้องบันทึกคดีใน config ถ้ามี ไม่งั้นห้องนี้)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let target = interaction.options.getChannel("ห้อง");
    if (!target && config.caseChannelId && !config.caseChannelId.startsWith("ใส่_")) {
      target = await interaction.client.channels.fetch(config.caseChannelId).catch(() => null);
    }
    target = target || interaction.channel;

    await target.send({ embeds: [embeds.casePanelEmbed()], components: [embeds.casePanelRow()] });
    await interaction.editReply({ embeds: [embeds.successEmbed(`โพสต์แผงระบบส่งเคสในห้อง <#${target.id}> เรียบร้อยแล้ว`)] });
  },
};
