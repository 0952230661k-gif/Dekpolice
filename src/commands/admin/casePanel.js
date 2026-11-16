const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const embeds = require("../../utils/embeds");
const { isAdmin } = require("../../utils/permissions");
const config = require("../../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("แผงเคส")
    .setDescription("โพสต์แผงระบบส่งเคส (Case Report) พร้อมปุ่มดูข้อมูล/อันดับ (แอดมินเท่านั้น)")
    .addStringOption((opt) =>
      opt
        .setName("ประเภท")
        .setDescription("แผงของห้องไหน (ค่าเริ่มต้น: เคสปกติ)")
        .addChoices({ name: "เคสปกติ", value: "normal" }, { name: "เคสอุ้มห่อ", value: "kidnap" })
        .setRequired(false)
    )
    .addChannelOption((opt) =>
      opt
        .setName("ห้อง")
        .setDescription("ห้องที่จะโพสต์แผง (ค่าเริ่มต้น: ห้องส่งเคสตามประเภทใน config ถ้ามี ไม่งั้นห้องนี้)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ embeds: [embeds.errorEmbed("คำสั่งนี้สำหรับแอดมินเท่านั้น")], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const kind = interaction.options.getString("ประเภท") || "normal";
    const defaultId = kind === "kidnap" ? config.kidnapCaseChannelId : config.caseChannelId;
    let target = interaction.options.getChannel("ห้อง");
    if (!target && defaultId && !defaultId.startsWith("ใส่_")) {
      target = await interaction.client.channels.fetch(defaultId).catch(() => null);
    }
    target = target || interaction.channel;

    try {
      await target.send({ embeds: [embeds.casePanelEmbed(kind)], components: [embeds.casePanelRow()] });
    } catch (err) {
      console.error("โพสต์แผงเคสไม่สำเร็จ:", err);
      return interaction.editReply({
        embeds: [embeds.errorEmbed(`โพสต์แผงเคสในห้อง <#${target.id}> ไม่สำเร็จ: ${err.message}\nตรวจสอบว่าบอทมีสิทธิ์ดูห้อง ส่งข้อความ และฝัง embed ในห้องนี้`)],
      });
    }
    await interaction.editReply({ embeds: [embeds.successEmbed(`โพสต์แผงระบบส่งเคสในห้อง <#${target.id}> เรียบร้อยแล้ว`)] });
  },
};
