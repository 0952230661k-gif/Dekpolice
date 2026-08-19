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
  console.error("ลงทะเบียนคำสั่งล้มเหลว:", err);
  process.exit(1);
});
