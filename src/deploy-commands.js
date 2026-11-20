require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

function loadCommands() {
  const commands = [];
  const commandsDir = path.join(__dirname, "commands");

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".js")) {
        const command = require(fullPath);
        if (command?.data) commands.push(command.data.toJSON());
      }
    }
  }

  walk(commandsDir);
  return commands;
}

async function main() {
  const commands = loadCommands();
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);

  console.log(`กำลังลงทะเบียน ${commands.length} slash commands...`);

  // ใช้ guild command เพื่อให้อัปเดตทันที (แนะนำระหว่างพัฒนา)
  // ถ้าต้องการใช้แบบ global (ใช้เวลาสูงสุด 1 ชม. ในการอัปเดต) ให้เปลี่ยนเป็น Routes.applicationCommands(...)
  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );

  console.log(`ลงทะเบียนสำเร็จ ${data.length} คำสั่ง`);
}

main().catch((err) => {
  console.error(`❌ ลงทะเบียนคำสั่งล้มเหลว: [${err.code || ""}] ${err.message}`);
  if (err.code === 50001) {
    console.error(
      "→ Missing Access: บอทยังไม่ได้อยู่ในเซิร์ฟเวอร์ DISCORD_GUILD_ID นี้ หรือเชิญมาโดยไม่มี scope 'applications.commands'\n" +
        "   1) Developer Portal > OAuth2 > URL Generator ติ๊ก scope: bot + applications.commands แล้วเปิดลิงก์เชิญบอทเข้าเซิร์ฟเวอร์ที่ถูกต้อง\n" +
        "   2) ตรวจว่า DISCORD_GUILD_ID ใน Render เป็นไอดีของเซิร์ฟเวอร์นั้น (คลิกขวาที่ไอคอนเซิร์ฟเวอร์ > Copy Server ID)"
    );
  } else if (err.code === 50035 || err.status === 401) {
    console.error("→ ตรวจ DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID ใน Environment ว่าถูกต้องและตรงกับบอทตัวเดียวกัน");
  }
  // ถ้าลงทะเบียนคำสั่งไม่ได้ ไม่ควรทำให้ deploy บน Render ล้มทั้งก้อน (บอทยังเปิดใช้งานด้วยคำสั่งเดิมได้)
  // ใส่ DEPLOY_STRICT=1 ถ้าต้องการให้ล้มจริงๆ
  process.exit(process.env.DEPLOY_STRICT === "1" ? 1 : 0);
});
