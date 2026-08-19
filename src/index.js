require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const embeds = require("./utils/embeds");
const dutyActions = require("./utils/dutyActions");
const panel = require("./utils/panel");
const applicationPanel = require("./utils/applicationPanel");
const queue = require("./utils/queue");
const { sendLog } = require("./utils/permissions");
const adminPanelHandler = require("./handlers/adminPanelHandler");
const queueHandler = require("./handlers/queueHandler");
const plateHandler = require("./handlers/plateHandler");
const applicationHandler = require("./handlers/applicationHandler");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();

function loadCommands(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath);
    } else if (entry.name.endsWith(".js")) {
      const command = require(fullPath);
      if (command?.data?.name) {
        client.commands.set(command.data.name, command);
      }
    }
  }
}

loadCommands(path.join(__dirname, "commands"));

client.once("ready", async () => {
  console.log(`บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
  console.log(`โหลดคำสั่งทั้งหมด ${client.commands.size} คำสั่ง`);
  await panel.refreshPanel(client); // ซิงก์แผงเข้าเวรที่ปักไว้ให้ตรงกับสถานะล่าสุดหลังบอทรีสตาร์ท
  await queue.refreshQueuePanel(client); // ซิงก์แผงคิวแพทย์ที่ปักไว้เช่นกัน
  await applicationPanel.refreshApplicationPanel(client); // ซิงก์แผงสมัครที่ปักไว้ให้ตรงกับ config ล่าสุด
  // หมายเหตุ: ระบบเคลียร์ฐานข้อมูลรายสัปดาห์ (weeklyReset) เป็นแบบแอดมินสั่งเองเท่านั้น
  // (ผ่านคำสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ หรือปุ่มในแผงแอดมิน) จึงไม่มีการรันอัตโนมัติตอนบอทเริ่มทำงาน
  queue.start(client); // เริ่มระบบเช็คคนพักหมดเวลาในคิวแพทย์อัตโนมัติ
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในคำสั่ง /${interaction.commandName}:`, err);
      const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผลคำสั่ง กรุณาลองใหม่อีกครั้ง")] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorReply).catch(() => {});
      } else {
        await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId === "duty_checkin" || interaction.customId === "duty_checkout") {
      try {
        await interaction.deferReply({ ephemeral: true });

        const result =
          interaction.customId === "duty_checkin"
            ? await dutyActions.checkIn(interaction.user)
            : await dutyActions.checkOut(interaction.user);

        if (result.ok) {
          const successMessage =
            interaction.customId === "duty_checkin" ? "เข้าเวรสำเร็จ" : "ออกเวรสำเร็จ";
          await interaction.editReply({ embeds: [embeds.successEmbed(successMessage)] });

          const logKey = interaction.customId === "duty_checkin" ? "เข้าเวร" : "ออกเวร";
          await sendLog(interaction.client, logKey, result.logEmbed);
          await panel.refreshPanel(interaction.client);
        } else {
          await interaction.editReply({ embeds: [result.embed] });
        }
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดขณะกดปุ่ม ${interaction.customId}:`, err);
        const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผล กรุณาลองใหม่อีกครั้ง")] };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(errorReply).catch(() => {});
        } else {
          await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.customId.startsWith("ap_")) {
      try {
        await adminPanelHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    if (interaction.customId.startsWith("q_")) {
      try {
        await queueHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในระบบคิวแพทย์ (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    if (interaction.customId.startsWith("plate_")) {
      try {
        await plateHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในระบบป้ายทะเบียน (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    if (interaction.customId.startsWith("form_")) {
      try {
        await applicationHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในระบบใบสมัคร (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
    }
    return;
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith("ap_select_")) {
    try {
      await adminPanelHandler.handleUserSelect(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (user select ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ap_select_")) {
    try {
      await adminPanelHandler.handleStringSelect(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (string select ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("ap_modal_")) {
    try {
      await adminPanelHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในแผงแอดมิน (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("q_modal_")) {
    try {
      await queueHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบคิวแพทย์ (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("plate_modal_")) {
    try {
      await plateHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบป้ายทะเบียน (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("form_modal_")) {
    try {
      await applicationHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบใบสมัคร (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }
});

async function safeErrorReply(interaction) {
  const errorReply = { embeds: [embeds.errorEmbed("เกิดข้อผิดพลาดขณะประมวลผล กรุณาลองใหม่อีกครั้ง")] };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(errorReply).catch(() => {});
  } else {
    await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
  }
}

// เปิด HTTP server เล็กๆ เพื่อให้ Render มองเห็นพอร์ตเปิดอยู่ (จำเป็นสำหรับ Web Service)
const http = require("node:http");
const https = require("node:https");
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Duty bot is running.");
  })
  .listen(PORT, () => console.log(`HTTP keep-alive server listening on port ${PORT}`));

// ===== Self-Ping: บอทปิงตัวเองทุก 4 นาที กัน Render สั่ง sleep =====
// ใส่ URL จริงของบอทใน Environment Variable ชื่อ RENDER_EXTERNAL_URL บน Render
// (หรือแก้ค่า default ด้านล่างให้ตรงกับ URL จริงของคุณ)
const SELF_PING_URL = process.env.RENDER_EXTERNAL_URL || "https://police-by-rogun.onrender.com";
const SELF_PING_INTERVAL_MS = 4 * 60 * 1000; // 4 นาที

function pingSelf() {
  // เลือกใช้ http หรือ https module ให้ตรงกับ protocol ของ URL จริง
  // ป้องกัน ERR_INVALID_PROTOCOL ตอน SELF_PING_URL เป็น https:// (ค่า default ของ Render)
  const client = SELF_PING_URL.startsWith("https:") ? https : http;
  client
    .get(SELF_PING_URL, (res) => {
      console.log(`[Self-Ping] ปิงตัวเองสำเร็จ - สถานะ ${res.statusCode}`);
      res.resume(); // consume response body กัน socket ค้าง
    })
    .on("error", (err) => {
      console.error("[Self-Ping] ปิงไม่สำเร็จ:", err.message);
    });
}

setInterval(pingSelf, SELF_PING_INTERVAL_MS);
// ==================================================================

client.login(process.env.DISCORD_TOKEN);
