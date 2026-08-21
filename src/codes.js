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
 * หาเลขลำดับถัดไปของ prefix นั้น (นับแยกอิสระต่อหมวดหมู่)
 *
 * นับจาก item_code ที่ขึ้นต้นด้วย prefix นี้และตามด้วยตัวเลข 4 หลักพอดี
 * จึงไม่ปนกับ prefix อื่นที่ขึ้นต้นเหมือนกัน (เช่น TLP กับ TLP2)
 * และรหัสของสินค้าที่ถูกย้ายหมวดหมู่ไปแล้วก็ยังถูกนับ ทำให้เลขไม่ถูกใช้ซ้ำ
 */
function nextSequence(db, prefix) {
  const row = db
    .prepare('SELECT MAX(CAST(SUBSTR(item_code, ?) AS INTEGER)) AS n FROM items WHERE item_code GLOB ?')
    .get(prefix.length + 1, prefix + '[0-9]'.repeat(CODE_DIGITS));
  return (row.n || 0) + 1;
}

module.exports = {
  makeBasePrefix,
  normalizePrefix,
  uniquePrefix,
  formatItemCode,
  nextSequence,
  THAI_CONSONANTS,
  PREFIX_MAX_LENGTH,
  PREFIX_MIN_LENGTH,
  FALLBACK_PREFIX,
  CODE_DIGITS,
};
