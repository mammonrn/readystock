'use strict';

// ตารางถอดพยัญชนะไทยเป็นอักษรโรมัน ใช้ตอนสร้าง prefix ให้หมวดหมู่ชื่อภาษาไทย
const THAI_CONSONANTS = {
  ก: 'K', ข: 'K', ฃ: 'K', ค: 'K', ฅ: 'K', ฆ: 'K', ง: 'N',
  จ: 'C', ฉ: 'C', ช: 'C', ซ: 'S', ฌ: 'C', ญ: 'Y',
  ฎ: 'D', ฏ: 'T', ฐ: 'T', ฑ: 'T', ฒ: 'T', ณ: 'N',
  ด: 'D', ต: 'T', ถ: 'T', ท: 'T', ธ: 'T', น: 'N',
  บ: 'B', ป: 'P', ผ: 'P', ฝ: 'F', พ: 'P', ฟ: 'F', ภ: 'P', ม: 'M',
  ย: 'Y', ร: 'R', ล: 'L', ว: 'W',
  ศ: 'S', ษ: 'S', ส: 'S', ห: 'H', ฬ: 'L', อ: 'O', ฮ: 'H',
};

const PREFIX_MIN_LENGTH = 2;
const PREFIX_BASE_LENGTH = 3;
const PREFIX_MAX_LENGTH = 8;
const FALLBACK_PREFIX = 'CAT';
const CODE_DIGITS = 4;

/**
 * สร้าง prefix ตั้งต้นจากชื่อหมวดหมู่ (ยังไม่ตรวจว่าซ้ำกับของเดิมหรือไม่)
 * - ใช้ตัวอักษร/ตัวเลขภาษาอังกฤษ 3 ตัวแรกก่อน เช่น "Furniture" -> "FUR"
 * - ถ้าไม่พอ (ชื่อไทยหรือสั้นเกินไป) จะถอดพยัญชนะไทยมาเติม เช่น "โทรศัพท์" -> "TRS"
 * - ถ้ายังไม่พออีกจะใช้ค่าสำรอง "CAT" แล้วค่อยต่อเลขให้ไม่ซ้ำ
 */
function makeBasePrefix(name) {
  const text = String(name || '');
  const ascii = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (ascii.length >= PREFIX_BASE_LENGTH) return ascii.slice(0, PREFIX_BASE_LENGTH);

  let thai = '';
  for (const char of text) {
    if (THAI_CONSONANTS[char]) thai += THAI_CONSONANTS[char];
    if (ascii.length + thai.length >= PREFIX_BASE_LENGTH) break;
  }

  const combined = (ascii + thai).slice(0, PREFIX_BASE_LENGTH);
  return combined.length >= PREFIX_MIN_LENGTH ? combined : FALLBACK_PREFIX;
}

/** ตรวจรูปแบบ prefix ที่แอดมินกรอกเอง */
function normalizePrefix(input) {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * หา prefix ที่ยังไม่ซ้ำกับหมวดหมู่อื่น ถ้าชนจะต่อเลขท้ายให้ (TLP, TLP2, TLP3, ...)
 * @param {string} [base] ถ้าไม่ระบุจะสร้างจากชื่อหมวดหมู่ให้
 */
function uniquePrefix(db, name, { base, excludeId = null } = {}) {
  const start = normalizePrefix(base) || makeBasePrefix(name);
  const taken = db.prepare('SELECT id FROM categories WHERE code_prefix = ? AND id IS NOT ?');

  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const candidate = suffix === 1 ? start : `${start}${suffix}`.slice(0, PREFIX_MAX_LENGTH);
    if (!taken.get(candidate, excludeId)) return candidate;
  }
  throw new Error(`หา prefix ที่ไม่ซ้ำสำหรับ "${name}" ไม่ได้`);
}

/** ประกอบรหัสสินค้าจาก prefix + เลขลำดับ เช่น ("TLP", 7) -> "TLP0007" */
function formatItemCode(prefix, sequence) {
  return `${prefix}${String(sequence).padStart(CODE_DIGITS, '0')}`;
}

/**
 * จองเลขลำดับถัดไปของ prefix นั้น (นับแยกอิสระต่อ prefix)
 *
 * ตัวนับเก็บอยู่ในตาราง prefix_counters แยกตาม prefix โดยตรง ไม่ได้ผูกกับ category_id
 * จึงกันรหัสชนกันได้แม้หมวดหมู่คนละอันจะเคยใช้ prefix เดียวกันคนละช่วงเวลา
 * และเป็นตัวนับที่เดินหน้าอย่างเดียว ลบสินค้าแล้วเลขนั้นจะไม่ถูกนำกลับมาใช้ซ้ำ
 *
 * ต้องเรียกอยู่ใน transaction เดียวกับตอน INSERT สินค้า เพื่อให้การจองเลขกับการบันทึกเป็นหน่วยเดียวกัน
 * @returns {number} เลขลำดับที่จองได้ (เริ่มที่ 1 สำหรับ prefix ที่ยังไม่เคยถูกใช้)
 */
function allocateSequence(db, prefix) {
  const row = db
    .prepare(
      `INSERT INTO prefix_counters (prefix, last_number) VALUES (?, 1)
       ON CONFLICT(prefix) DO UPDATE SET last_number = last_number + 1, updated_at = datetime('now')
       RETURNING last_number`
    )
    .get(prefix);
  return row.last_number;
}

/** ดันตัวนับของ prefix ขึ้นไปอย่างน้อยเท่ากับค่าที่ระบุ (ไม่ลดค่าลง) */
function bumpCounter(db, prefix, value) {
  if (!prefix || !Number.isInteger(value) || value <= 0) return;
  db.prepare(
    `INSERT INTO prefix_counters (prefix, last_number) VALUES (?, ?)
     ON CONFLICT(prefix) DO UPDATE SET last_number = MAX(last_number, excluded.last_number),
                                       updated_at = datetime('now')`
  ).run(prefix, value);
}

/** ค่าปัจจุบันของตัวนับ (ไว้ดู/ทดสอบ) */
function currentCounter(db, prefix) {
  const row = db.prepare('SELECT last_number FROM prefix_counters WHERE prefix = ?').get(prefix);
  return row ? row.last_number : 0;
}

module.exports = {
  makeBasePrefix,
  normalizePrefix,
  uniquePrefix,
  formatItemCode,
  allocateSequence,
  bumpCounter,
  currentCounter,
  THAI_CONSONANTS,
  PREFIX_MAX_LENGTH,
  PREFIX_MIN_LENGTH,
  FALLBACK_PREFIX,
  CODE_DIGITS,
};
