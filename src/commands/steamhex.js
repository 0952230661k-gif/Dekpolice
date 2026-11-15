const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const steamId = require("../utils/steamId");
const embeds = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("steamhex")
    .setDescription("แปลงลิงก์ Steam / SteamID64 เป็น Steam Hex (ใช้สำหรับ FiveM)")
    .addStringOption((option) =>
      option
        .setName("ลิงก์")
        .setDescription("ลิงก์โปรไฟล์ Steam (steamcommunity.com/profiles/... หรือ /id/...) หรือเลข SteamID64")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const input = interaction.options.getString("ลิงก์", true).trim();
    const result = await steamId.convert(input);

    if (!result.ok) {
      return interaction.editReply({ embeds: [embeds.errorEmbed(result.reason)] });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🔧 แปลง Steam Hex")
      .addFields(
        { name: "Steam Hex (FiveM)", value: `\`${result.hex}\``, inline: false },
        { name: "SteamID64", value: `\`${result.steamId64}\``, inline: true },
        { name: "ลิงก์โปรไฟล์", value: result.profileUrl, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
