'use strict';

const crypto = require('node:crypto');
const { AppError } = require('../errors');

// ตัวอักษรแบบ base32 ที่อ่านง่าย ตัดตัวที่สับสนออก (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DEFAULT_TTL_HOURS = 24;
const MAX_PER_BATCH = 100;

/** สุ่มรหัสเชิญด้วย crypto.randomBytes (ใช้วิธี rejection sampling ให้แต่ละตัวอักษรมีโอกาสเท่ากัน) */
function generateCode(length = CODE_LENGTH) {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = '';
  while (code.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (byte >= limit) continue; // ทิ้งค่าที่ทำให้การกระจายไม่สม่ำเสมอ
      code += ALPHABET[byte % ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/** ปรับรหัสที่ผู้ใช้พิมพ์เข้ามาให้เป็นรูปแบบมาตรฐาน (ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง/ขีด) */
function normalizeCode(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

/**
 * สร้างรหัสเชิญใหม่หลายรหัสในครั้งเดียว (หมดอายุใน 24 ชั่วโมง)
 * @returns {object[]} รายการรหัสที่สร้าง
 */
function createCodes(db, { count = 1, createdBy, ttlHours = DEFAULT_TTL_HOURS } = {}) {
  const amount = Number(count);
  if (!Number.isInteger(amount) || amount < 1) throw new AppError('จำนวนรหัสเชิญต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
  if (amount > MAX_PER_BATCH) throw new AppError(`สร้างรหัสเชิญได้ครั้งละไม่เกิน ${MAX_PER_BATCH} รหัส`);

  const insert = db.prepare(
    `INSERT INTO invite_codes (code, created_by, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  );

  const run = db.transaction(() => {
    const created = [];
    for (let i = 0; i < amount; i += 1) {
      let inserted = false;
      // เผื่อกรณีสุ่มได้รหัสซ้ำ (โอกาสน้อยมาก) ให้ลองใหม่
      for (let attempt = 0; attempt < 10 && !inserted; attempt += 1) {
        const code = generateCode();
        try {
          const info = insert.run(code, createdBy ?? null, `+${ttlHours} hours`);
          created.push(db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(info.lastInsertRowid));
          inserted = true;
        } catch (err) {
          if (!String(err.message).includes('UNIQUE')) throw err;
        }
      }
      if (!inserted) throw new AppError('สร้างรหัสเชิญไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
    return created;
  });

  return run();
}

// ดูจาก used_at ไม่ใช่ used_by เพราะ used_by จะถูกตั้งเป็น NULL เมื่อผู้ใช้คนนั้นถูกลบ
// (ถ้าดูจาก used_by รหัสที่ใช้ไปแล้วจะกลับมาใช้ซ้ำได้อีกเมื่อลบผู้ใช้)
const STATUS_SQL = `CASE
    WHEN i.used_at IS NOT NULL THEN 'used'
    WHEN i.expires_at <= datetime('now') THEN 'expired'
    ELSE 'active'
  END`;

/** รายการรหัสเชิญทั้งหมด เรียงรหัสที่ยังใช้ได้ไว้บนสุด */
function listCodes(db, { limit = 200 } = {}) {
  return db
    .prepare(
      `SELECT i.*,
              ${STATUS_SQL} AS status,
              cu.username AS created_by_name,
              uu.username AS used_by_name
         FROM invite_codes i
         LEFT JOIN users cu ON cu.id = i.created_by
         LEFT JOIN users uu ON uu.id = i.used_by
        ORDER BY CASE ${STATUS_SQL} WHEN 'active' THEN 0 WHEN 'used' THEN 1 ELSE 2 END,
                 i.id DESC
        LIMIT ?`
    )
    .all(limit);
}

/** นับรหัสที่ยังใช้ได้อยู่ */
function countActive(db) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM invite_codes WHERE used_at IS NULL AND expires_at > datetime('now')")
    .get().n;
}

/**
 * ตรวจว่ารหัสเชิญใช้ได้หรือไม่ ถ้าไม่ได้จะโยน AppError พร้อมเหตุผลที่ชัดเจน
 * @returns {object} แถวของรหัสเชิญที่ใช้ได้
 */
function assertUsable(db, inputCode) {
  const code = normalizeCode(inputCode);
  if (!code) throw new AppError('กรุณากรอกรหัสเชิญ');

  const row = db.prepare(`SELECT i.*, ${STATUS_SQL} AS status FROM invite_codes i WHERE i.code = ?`).get(code);
  if (!row) throw new AppError('รหัสเชิญไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือขอรหัสใหม่จากผู้ดูแลระบบ');
  if (row.status === 'used') throw new AppError('รหัสเชิญนี้ถูกใช้ไปแล้ว รหัสหนึ่งรหัสใช้สมัครได้เพียงครั้งเดียว');
  if (row.status === 'expired') throw new AppError('รหัสเชิญนี้หมดอายุแล้ว (รหัสมีอายุ 24 ชั่วโมง) กรุณาขอรหัสใหม่จากผู้ดูแลระบบ');
  return row;
}

/** ทำเครื่องหมายว่ารหัสถูกใช้ไปแล้วโดยผู้ใช้คนนี้ */
function markUsed(db, codeId, userId) {
  const info = db
    .prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE id = ? AND used_at IS NULL")
    .run(userId, codeId);
  if (info.changes !== 1) throw new AppError('รหัสเชิญนี้ถูกใช้ไปแล้ว รหัสหนึ่งรหัสใช้สมัครได้เพียงครั้งเดียว');
  return db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(codeId);
}

module.exports = {
  createCodes,
  listCodes,
  countActive,
  assertUsable,
  markUsed,
  generateCode,
  normalizeCode,
  ALPHABET,
  CODE_LENGTH,
  DEFAULT_TTL_HOURS,
  MAX_PER_BATCH,
};
