// รวมฟังก์ชันที่ใช้ "ซิงก์" สถานะในดิสคอร์ด (ยศ/ชื่อเล่น) ให้ตรงกับข้อมูลในระบบ
// ใช้ร่วมกันทั้งตอนยื่น/อนุมัติใบสมัคร (applicationHandler.js) และตอนแก้ไขตำแหน่ง (setPosition.js)

// เปลี่ยนชื่อเล่น (Nickname) ในดิสคอร์ดของสมาชิกคนหนึ่ง
// interaction ต้องมี .guild (ใช้ได้เฉพาะตอนเกิดจาก guild interaction)
async function setNickname(interaction, discordId, nickname) {
  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "สมาชิกไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงเปลี่ยนชื่อไม่ได้" };
    }

    // Discord ห้ามบอทเปลี่ยนชื่อเล่นของเจ้าของเซิร์ฟเวอร์ (Server Owner) ไม่ว่ากรณีใด
    if (guild.ownerId === discordId) {
      return { ok: false, reason: "ไม่สามารถเปลี่ยนชื่อเล่นของเจ้าของเซิร์ฟเวอร์ได้ (ข้อจำกัดของ Discord)" };
    }

    const trimmed = nickname.slice(0, 32); // ดิสคอร์ดจำกัดชื่อเล่นไม่เกิน 32 ตัวอักษร
    await member.setNickname(trimmed);
    return { ok: true, nickname: trimmed };
  } catch (err) {
    // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศสูงสุดของสมาชิกคนนั้น หรือบอทไม่มีสิทธิ์ Manage Nicknames
    console.error(`เปลี่ยนชื่อเล่นให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

// แจกยศ (Role) หลายอันพร้อมกันให้สมาชิกคนหนึ่ง (ใช้ตอนอนุมัติใบสมัครครั้งแรก)
async function assignRoles(interaction, discordId, roleIds) {
  const ids = (roleIds || []).filter((id) => id && !id.startsWith("ใส่_"));
  if (ids.length === 0) return null; // ยังไม่ได้ตั้งค่า ข้ามไปเงียบๆ

  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "สมาชิกไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงแจกยศไม่ได้" };
    }

    const added = [];
    const failed = [];

    for (const roleId of ids) {
      try {
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          failed.push(`\`${roleId}\` (ไม่พบยศนี้)`);
          continue;
        }
        await member.roles.add(role);
        added.push(`<@&${roleId}>`);
      } catch (err) {
        // เกิดได้บ่อยตอนยศของบอทอยู่ต่ำกว่ายศเป้าหมาย หรือบอทไม่มีสิทธิ์ Manage Roles
        failed.push(`<@&${roleId}> (${err.message})`);
      }
    }

    return { ok: failed.length === 0, added, failed };
  } catch (err) {
    console.error(`แจกยศให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

// ถอดยศตำแหน่งเก่า + ใส่ยศตำแหน่งใหม่ ตาม mapping { ชื่อตำแหน่ง: roleId }
// ใช้ตอนแก้ไขตำแหน่งสมาชิก (setPosition.js)
async function swapPositionRole(interaction, discordId, oldPosition, newPosition, positionRoleMap) {
  const roleMap = positionRoleMap || {};
  if (Object.keys(roleMap).length === 0) return null;

  const oldRoleId = roleMap[oldPosition];
  const newRoleId = roleMap[newPosition];

  try {
    const guild = interaction.guild;
    if (!guild) return { ok: false, reason: "ไม่พบเซิร์ฟเวอร์ (ใช้นอกกิลด์)" };

    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      return { ok: false, reason: "สมาชิกไม่ได้อยู่ในเซิร์ฟเวอร์แล้ว จึงเปลี่ยนยศไม่ได้" };
    }

    const removed = [];
    const added = [];
    const failed = [];

    if (oldRoleId && oldRoleId !== newRoleId && member.roles.cache.has(oldRoleId)) {
      try {
        await member.roles.remove(oldRoleId);
        removed.push(`<@&${oldRoleId}>`);
      } catch (err) {
        failed.push(`ถอด <@&${oldRoleId}> ไม่สำเร็จ (${err.message})`);
      }
    }

    if (newRoleId && !member.roles.cache.has(newRoleId)) {
      try {
        const role = await guild.roles.fetch(newRoleId).catch(() => null);
        if (!role) {
          failed.push(`\`${newRoleId}\` (ไม่พบยศนี้)`);
        } else {
          await member.roles.add(role);
          added.push(`<@&${newRoleId}>`);
        }
      } catch (err) {
        failed.push(`เพิ่ม <@&${newRoleId}> ไม่สำเร็จ (${err.message})`);
      }
    }

    return { ok: failed.length === 0, removed, added, failed };
  } catch (err) {
    console.error(`สลับยศตำแหน่งให้ ${discordId} ไม่สำเร็จ:`, err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { setNickname, assignRoles, swapPositionRole };
