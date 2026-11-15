const config = require("../../config.json");

function isAdmin(interaction) {
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  return config.adminRoleIds.some((roleId) => memberRoles.has(roleId));
}

async function sendLog(client, channelKey, embed) {
  const channelId = config.logChannels[channelKey];
  if (!channelId || channelId.startsWith("ใส่_") || channelId === "-") return false; // ยังไม่ได้ตั้งค่า ข้ามไป
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return false;
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(`ส่ง log ไปห้อง ${channelKey} ไม่สำเร็จ:`, err.message);
    return false;
  }
}

module.exports = { isAdmin, sendLog };
