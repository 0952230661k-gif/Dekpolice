// ---------- ตัวช่วยแปลง Steam ID / ลิงก์ Steam เป็น Steam Hex (รูปแบบที่ FiveM ใช้) ----------
//
// SteamID64 ทุกตัวของ FiveM คือ Steam Hex ที่ได้จากการแปลงเลข SteamID64 (เลขฐาน 10)
// เป็นเลขฐาน 16 ตรงๆ แล้วเติม "steam:" นำหน้า เช่น
//   76561198025644647  ->  steam:110000103e59a67
// ไม่จำเป็นต้องเรียกเว็บภายนอก (เช่น steamid.pro) เพื่อแปลงเลย คำนวณได้ในบอทเลย
//
// รองรับรูปแบบอินพุตต่อไปนี้:
//   - ลิงก์โปรไฟล์แบบตัวเลข: https://steamcommunity.com/profiles/76561198025644647/
//   - เลข SteamID64 ดิบๆ: 76561198025644647
//   - Steam Hex ที่มีอยู่แล้ว: steam:110000103e59a67 (เผื่อกรอกผิดจะแจ้งกลับ)
//   - ลิงก์ vanity (custom URL): https://steamcommunity.com/id/somename/
//     กรณีนี้ต้องดึงหน้าเว็บมาอ่านค่า SteamID64 ก่อน (resolveSteamId64 เป็น async)

const STEAM64_BASE = 76561197960265728n; // จุดเริ่มต้นของช่วง SteamID64 บัญชีบุคคล
const STEAM64_REGEX = /\b(7656\d{13})\b/; // SteamID64 มีทั้งหมด 17 หลัก ขึ้นต้นด้วย 7656

/** ดึงเลข SteamID64 (string) จากอินพุตที่เป็นตัวเลขล้วนหรือลิงก์ /profiles/ เท่านั้น (ไม่ทำ network request) */
function extractSteamId64(input) {
  if (!input) return null;
  const text = String(input).trim();

  const match = text.match(STEAM64_REGEX);
  if (match) return match[1];

  return null;
}

/** เช็คว่าเป็นลิงก์ vanity (/id/ชื่อ) ที่ต้อง resolve ผ่านเว็บก่อนหรือไม่ */
function isVanityUrl(input) {
  if (!input) return false;
  return /steamcommunity\.com\/id\/[^\/\s]+/i.test(String(input).trim());
}

/**
 * พยายาม resolve อินพุตให้เป็น SteamID64
 * - ถ้าเป็นเลขดิบหรือลิงก์ /profiles/ อยู่แล้ว จะได้ผลลัพธ์ทันทีแบบไม่ต้องต่อเน็ต
 * - ถ้าเป็นลิงก์ /id/ชื่อ (vanity) จะดึงหน้าโปรไฟล์มาอ่านค่า SteamID64 ให้อัตโนมัติ
 * คืนค่า { ok: true, steamId64 } หรือ { ok: false, reason }
 */
async function resolveSteamId64(input) {
  if (!input || !String(input).trim()) {
    return { ok: false, reason: "กรุณาใส่ลิงก์ Steam หรือ SteamID64" };
  }

  const direct = extractSteamId64(input);
  if (direct) return { ok: true, steamId64: direct };

  if (isVanityUrl(input)) {
    try {
      const url = String(input).trim();
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) {
        return { ok: false, reason: `เปิดลิงก์ไม่สำเร็จ (HTTP ${res.status})` };
      }
      const html = await res.text();
      const fromCanonical = html.match(/steamcommunity\.com\/profiles\/(7656\d{13})/i);
      const fromScript = html.match(/"steamid":"(7656\d{13})"/i);
      const steamId64 = (fromCanonical && fromCanonical[1]) || (fromScript && fromScript[1]) || null;
      if (!steamId64) {
        return { ok: false, reason: "ไม่พบ SteamID64 ในหน้าโปรไฟล์ (โปรไฟล์อาจตั้งค่าความเป็นส่วนตัวไว้)" };
      }
      return { ok: true, steamId64 };
    } catch (err) {
      return { ok: false, reason: `ดึงข้อมูลจากลิงก์ไม่สำเร็จ: ${err.message}` };
    }
  }

  return {
    ok: false,
    reason: "รูปแบบไม่ถูกต้อง กรุณาใส่ลิงก์ https://steamcommunity.com/profiles/... หรือ /id/... หรือเลข SteamID64",
  };
}

/** แปลง SteamID64 (string) เป็น Steam Hex แบบที่ FiveM ใช้ เช่น steam:110000103e59a67 */
function steamId64ToHex(steamId64) {
  return `steam:${BigInt(steamId64).toString(16)}`;
}

/** แปลง SteamID64 เป็น SteamID2 (STEAM_0:X:Y) และ SteamID3 ([U:1:Z]) เพิ่มเติม ไว้ใช้อ้างอิง */
function steamId64ToLegacyIds(steamId64) {
  const id64 = BigInt(steamId64);
  const accountId = id64 - STEAM64_BASE;
  const y = accountId % 2n;
  const z = (accountId - y) / 2n;
  return {
    steamId2: `STEAM_0:${y}:${z}`,
    steamId3: `[U:1:${accountId}]`,
  };
}

/** ฟังก์ชันรวม: ใส่ลิงก์/เลข SteamID เข้ามา ได้ผลลัพธ์ครบชุดกลับไปเลย */
async function convert(input) {
  const resolved = await resolveSteamId64(input);
  if (!resolved.ok) return resolved;

  const { steamId64 } = resolved;
  const hex = steamId64ToHex(steamId64);
  const { steamId2, steamId3 } = steamId64ToLegacyIds(steamId64);

  return {
    ok: true,
    steamId64,
    hex,
    steamId2,
    steamId3,
    profileUrl: `https://steamcommunity.com/profiles/${steamId64}/`,
  };
}

module.exports = {
  extractSteamId64,
  isVanityUrl,
  resolveSteamId64,
  steamId64ToHex,
  steamId64ToLegacyIds,
  convert,
};
