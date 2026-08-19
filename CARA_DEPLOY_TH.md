# สรุปสิ่งที่แก้ไข และขั้นตอนที่ต้องทำต่อ

## 1. ลบ requirements.txt ออกแล้ว
ไฟล์นี้เคยทำให้ Render เข้าใจผิดว่าโปรเจกต์เป็น Python (เห็นได้จาก tag "Python 3"
ในหน้า Render Dashboard) ทั้งที่จริงเป็น Node.js/discord.js — ตอนนี้ลบออกแล้ว

## 2. เพิ่ม Self-Ping ใน src/index.js
เพิ่มโค้ดปิงตัวเองทุก 4 นาทีต่อจาก HTTP keep-alive server เดิมที่มีอยู่แล้ว

## 3. สิ่งที่ต้องทำต่อบน Render Dashboard
1. ไปที่ Settings ของ service นี้
2. เปลี่ยน Environment/Runtime จาก Python เป็น **Node**
3. ตั้งค่า:
   - Build Command: npm install
   - Start Command: node src/index.js
4. ไปที่ Environment variables เพิ่ม/เช็คว่ามี:
   - DISCORD_TOKEN = โทเคนบอทของคุณ
   - RENDER_EXTERNAL_URL = https://police-by-rogun.onrender.com

## 4. Push ขึ้น GitHub แล้ว deploy ใหม่
git add -A
git commit -m "แก้ runtime เป็น Node + เพิ่ม self-ping"
git push

## หมายเหตุ
- ไฟล์ data/duty.db (ฐานข้อมูลเดิม) ไม่ได้รวมมาด้วยเพราะอาจมีข้อมูลจริงของคุณอยู่
  ถ้าต้องการเก็บข้อมูลเดิม ให้คัดลอกไฟล์ data/duty.db, duty.db-shm, duty.db-wal
  จากโปรเจกต์เดิมกลับเข้ามาในโฟลเดอร์ data/ ก่อน push
