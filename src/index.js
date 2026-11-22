require("dotenv").config();
require("./utils/time"); // ตั้งเขตเวลา Asia/Bangkok ให้ทั้ง process ก่อนโหลดอย่างอื่น
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const embeds = require("./utils/embeds");
const dutyActions = require("./utils/dutyActions");
const panel = require("./utils/panel");
const applicationPanel = require("./utils/applicationPanel");
const { sendLog } = require("./utils/permissions");
const adminPanelHandler = require("./handlers/adminPanelHandler");
const applicationHandler = require("./handlers/applicationHandler");
const caseHandler = require("./handlers/caseHandler");
const storyHandler = require("./handlers/storyHandler");
const story = require("./utils/story");
const db = require("./utils/db");
const weeklyScheduler = require("./utils/weeklyScheduler");
const roster = require("./utils/roster");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ต้องเปิด MESSAGE CONTENT INTENT ใน Developer Portal ด้วย (ใช้อ่านข้อความในห้องบันทึกคดี)
  ],
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

/**
 * ปรับชื่อเล่นทุกคนในดิสคอร์ดให้เป็นรูปแบบใหม่ "เลข [ยศ] ชื่อ" (เช่น "[003] [รองผบ] Novem" → "3 [รองผบ] Novem")
 * ทำครั้งเดียวต่อรูปแบบ (จำสถานะไว้ใน bot_state) ข้ามคนที่บอทเปลี่ยนชื่อให้ไม่ได้ (เจ้าของเซิร์ฟเวอร์/ยศสูงกว่าบอท)
 */
const NICK_STYLE_KEY = "nickname_style";
const NICK_STYLE_VERSION = "plain-number-v1";
async function syncAllNicknamesOnce(client) {
  db.takeMigratedBadgeIds(); // เคลียร์คิวเดิม (การซิงก์ครั้งนี้ครอบคลุมทุกคนอยู่แล้ว)
  if ((await db.getState(NICK_STYLE_KEY)) === NICK_STYLE_VERSION) return;
  const members = await db.getAllMembers();
  let ok = 0;
  let same = 0;
  const failed = [];
  for (const m of members) {
    const nick = embeds.memberNickname({ badgeNumber: m.badgeNumber, position: m.position, gameName: m.gameName }).slice(0, 32);
    let found = false;
    for (const guild of client.guilds.cache.values()) {
      const gm = await guild.members.fetch(m.discordId).catch(() => null);
      if (!gm) continue;
      found = true;
      if (gm.nickname === nick) {
        same += 1;
        continue;
      }
      try {
        await gm.setNickname(nick);
        ok += 1;
      } catch (err) {
        failed.push(`${m.gameName} (${err.message})`);
      }
    }
    if (!found) failed.push(`${m.gameName} (ไม่ได้อยู่ในเซิร์ฟเวอร์)`);
  }
  await db.setState(NICK_STYLE_KEY, NICK_STYLE_VERSION);
  console.log(`[ชื่อเล่น] ปรับเป็นรูปแบบเลขล้วน สำเร็จ ${ok} คน · ตรงอยู่แล้ว ${same} คน · ไม่สำเร็จ ${failed.length} คน`);
  if (failed.length > 0) console.warn(`[ชื่อเล่น] ต้องเปลี่ยนเอง: ${failed.join(", ")}`);
  await roster.refreshRoster(client).catch(() => {});
}

client.once("ready", async () => {
  console.log(`บอทออนไลน์แล้วในชื่อ ${client.user.tag}`);
  console.log(`โหลดคำสั่งทั้งหมด ${client.commands.size} คำสั่ง`);
  await syncAllNicknamesOnce(client); // ปรับชื่อเล่นทุกคนเป็นรูปแบบ "เลข [ยศ] ชื่อ" ครั้งเดียว
  await panel.refreshPanel(client); // ซิงก์แผงเข้าเวรที่ปักไว้ให้ตรงกับสถานะล่าสุดหลังบอทรีสตาร์ท
  await story.refreshPanel(client); // ซิงก์แผงเวลาสตอรี่อุ้มให้ตรงสถานะล่าสุด
  await applicationPanel.refreshApplicationPanel(client); // ซิงก์แผงสมัครที่ปักไว้ให้ตรงกับ config ล่าสุด
  // ตัดรอบเวรอัตโนมัติ: 23:59 น. วันอาทิตย์ ปิดเวรที่ค้าง + สรุปลงห้องสัปดาห์ / 00:00 น. วันจันทร์ เปิดเวรต่อให้
  // (แอดมินยังสั่ง /เคลียร์ฐานข้อมูลรายสัปดาห์ เองได้เหมือนเดิม)
  await weeklyScheduler.start(client);
});

client.on("messageCreate", async (message) => {
  try {
    await caseHandler.handleMessage(message);
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในระบบบันทึกคดี:", err);
  }
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

    if (interaction.customId === "duty_afk" || interaction.customId === "duty_back") {
      try {
        const goAfk = interaction.customId === "duty_afk";
        const open = await db.findOpenDuty(interaction.user.id);
        if (!open) {
          return interaction.reply({ embeds: [embeds.errorEmbed("ต้องเข้าเวรก่อน จึงจะใช้ปุ่ม วอ.12 / วอ.4 ได้")], ephemeral: true });
        }
        const isAfk = (await db.getAfkIds()).includes(interaction.user.id);
        if (goAfk === isAfk) {
          return interaction.reply({
            embeds: [embeds.errorEmbed(goAfk ? "คุณอยู่สถานะ วอ.12 (ไม่อยู่หน้าจอ) อยู่แล้ว" : "คุณอยู่ในสถานะเข้าเวรปกติอยู่แล้ว")],
            ephemeral: true,
          });
        }
        const pausedMs = await db.setAfk(interaction.user.id, goAfk);
        await panel.refreshPanel(interaction.client);
        await interaction.reply({
          embeds: [
            embeds.successEmbed(
              goAfk
                ? "ตั้งสถานะ วอ.12 (ไม่อยู่หน้าจอ) แล้ว — เวลาเข้าเวรหยุดเดิน และ all จะไม่แท็กคุณ (กด วอ.4 เพื่อให้เวลาเดินต่อ)"
                : `วอ.4 กลับมาเข้าเวรแล้ว — เวลาเดินต่อ (พักไป ${Math.floor(pausedMs / 60000)} นาที ไม่นับในชั่วโมงเวร)`
            ),
          ],
          ephemeral: true,
        });
      } catch (err) {
        console.error("เกิดข้อผิดพลาดขณะสลับสถานะ วอ.12/วอ.4:", err);
        await safeErrorReply(interaction);
      }
      return;
    }

    if (interaction.customId.startsWith("story_")) {
      try {
        await storyHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในระบบเวลาสตอรี่ (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    if (interaction.customId.startsWith("case_")) {
      try {
        await caseHandler.handleButton(interaction);
      } catch (err) {
        console.error(`เกิดข้อผิดพลาดในระบบบันทึกคดี (ปุ่ม ${interaction.customId}):`, err);
        await safeErrorReply(interaction);
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

  if (
    (interaction.isUserSelectMenu() || interaction.isStringSelectMenu()) &&
    interaction.customId.startsWith("case_sel_")
  ) {
    try {
      await caseHandler.handleSelect(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบบันทึกคดี (เมนู ${interaction.customId}):`, err);
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

  if (interaction.isModalSubmit() && interaction.customId.startsWith("story_modal_")) {
    try {
      await storyHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบเวลาสตอรี่ (modal ${interaction.customId}):`, err);
      await safeErrorReply(interaction);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("case_modal_")) {
    try {
      await caseHandler.handleModalSubmit(interaction);
    } catch (err) {
      console.error(`เกิดข้อผิดพลาดในระบบบันทึกคดี (modal ${interaction.customId}):`, err);
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

// ===== ล็อกอินเข้า Discord พร้อมบอกสาเหตุให้ชัดเมื่อเข้าไม่ได้ (ดูได้ในหน้า Logs ของ Render) =====
process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
client.on("error", (err) => console.error("[Discord error]", err));
client.on("shardError", (err) => console.error("[Discord shardError]", err));
client.on("shardDisconnect", (ev, id) => console.warn(`[Discord] shard ${id} หลุดการเชื่อมต่อ (code ${ev?.code})`));

const rawToken = process.env.DISCORD_TOKEN;
if (!rawToken || !rawToken.trim()) {
  console.error("❌ ไม่พบ DISCORD_TOKEN ใน Environment ของ Render — ใส่ค่าโทเค็นของบอทที่ Environment แล้ว Save/Restart");
} else {
  // กันพลาดตอนก๊อปมาวาง: ช่องว่าง/ขึ้นบรรทัดใหม่/เครื่องหมายคำพูดครอบ/คำว่า DISCORD_TOKEN= ติดมาด้วย
  const token = rawToken.trim().replace(/^DISCORD_TOKEN=/, "").replace(/^["']|["']$/g, "");
  console.log(`[Discord] กำลังล็อกอิน... (โทเค็นยาว ${token.length} ตัวอักษร)`);
  client.login(token).catch((err) => {
    console.error("❌ ล็อกอิน Discord ไม่สำเร็จ:", err.code || "", err.message);
    if (/token/i.test(err.message)) console.error("→ โทเค็นไม่ถูกต้อง/ถูกรีเซ็ตไปแล้ว: ไปที่ Developer Portal > Bot > Reset Token แล้วใส่ค่าใหม่ใน Render (DISCORD_TOKEN)");
    if (/intent/i.test(err.message)) console.error("→ ต้องเปิด Server Members Intent และ Message Content Intent ที่ Developer Portal > Bot > Privileged Gateway Intents");
  });
}
