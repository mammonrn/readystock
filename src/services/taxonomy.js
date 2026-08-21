'use strict';

const { AppError } = require('../errors');
const { uniquePrefix, normalizePrefix, PREFIX_MIN_LENGTH, PREFIX_MAX_LENGTH } = require('../codes');

// ตาราง offices และ categories ใช้โครงสร้างใกล้เคียงกัน จึงใช้ฟังก์ชันชุดเดียวกันได้
// ต่างกันตรงที่ categories มี code_prefix (สำหรับออกรหัสสินค้า) และ sort_order (ลำดับการแสดงผล)
const TABLES = {
  offices: {
    table: 'offices',
    column: 'office_id',
    label: 'สำนักงาน',
    orderBy: 't.name COLLATE NOCASE',
    extraColumns: '',
  },
  categories: {
    table: 'categories',
    column: 'category_id',
    label: 'หมวดหมู่',
    orderBy: 't.sort_order, t.id',
    extraColumns: ', t.code_prefix, t.sort_order',
  },
};

function meta(kind) {
  const m = TABLES[kind];
  if (!m) throw new AppError('ประเภทข้อมูลไม่ถูกต้อง');
  return m;
}

function list(db, kind) {
  const { table, column, orderBy, extraColumns } = meta(kind);
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at${extraColumns},
              (SELECT COUNT(*) FROM items i WHERE i.${column} = t.id) AS item_count
         FROM ${table} t
        ORDER BY ${orderBy}`
    )
    .all();
}

function get(db, kind, id) {
  const { table } = meta(kind);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

function assertName(db, kind, name, excludeId = null) {
  const { table, label } = meta(kind);
  const value = String(name || '').trim();
  if (!value) throw new AppError(`กรุณากรอกชื่อ${label}`);
  if (value.length > 64) throw new AppError(`ชื่อ${label}ยาวเกิน 64 ตัวอักษร`);
  const dup = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND id IS NOT ?`).get(value, excludeId);
  if (dup) throw new AppError(`มี${label} "${value}" อยู่แล้ว`);
  return value;
}

/** ตรวจ prefix ที่แอดมินกรอกเอง (ปล่อยว่างได้ = ให้ระบบสร้างให้) */
function assertPrefix(db, prefix, excludeId = null) {
  const value = normalizePrefix(prefix);
  if (!value) return null;
  if (value.length < PREFIX_MIN_LENGTH || value.length > PREFIX_MAX_LENGTH) {
    throw new AppError(`รหัสนำหน้าต้องยาว ${PREFIX_MIN_LENGTH}-${PREFIX_MAX_LENGTH} ตัวอักษร (ใช้ได้เฉพาะ A-Z และ 0-9)`);
  }
  const dup = db.prepare('SELECT name FROM categories WHERE code_prefix = ? AND id IS NOT ?').get(value, excludeId);
  if (dup) throw new AppError(`รหัสนำหน้า "${value}" ถูกใช้กับหมวดหมู่ "${dup.name}" อยู่แล้ว`);
  return value;
}

function create(db, kind, name, options = {}) {
  const { table } = meta(kind);
  const value = assertName(db, kind, name);

  if (kind !== 'categories') {
    const info = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(value);
    return get(db, kind, info.lastInsertRowid);
  }

  const run = db.transaction(() => {
    // prefix ที่แอดมินกรอกมาเองมาก่อน ถ้าไม่กรอกให้สร้างจากชื่อหมวดหมู่
    // uniquePrefix จะต่อเลขท้ายให้เองถ้าชนกับหมวดหมู่ที่มีอยู่ (TLP, TLP2, TLP3, ...)
    const prefix = uniquePrefix(db, value, { base: assertPrefix(db, options.codePrefix) });
    const nextOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM categories').get().n || 0) + 1;
    const info = db
      .prepare('INSERT INTO categories (name, code_prefix, sort_order) VALUES (?, ?, ?)')
      .run(value, prefix, nextOrder);
    return get(db, kind, info.lastInsertRowid);
  });
  return run();
}

function rename(db, kind, id, name, options = {}) {
  const { table, label } = meta(kind);
  const row = get(db, kind, id);
  if (!row) throw new AppError(`ไม่พบ${label}ที่ต้องการแก้ไข`);
  const value = assertName(db, kind, name, id);

  if (kind !== 'categories') {
    db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(value, id);
    return get(db, kind, id);
  }

  const run = db.transaction(() => {
    // เปลี่ยน prefix ได้ แต่จะไม่กระทบรหัสสินค้าที่ออกไปแล้ว (มีผลกับสินค้าที่เพิ่มใหม่เท่านั้น)
    const prefix = assertPrefix(db, options.codePrefix, id) || row.code_prefix;
    db.prepare('UPDATE categories SET name = ?, code_prefix = ? WHERE id = ?').run(value, prefix, id);
    return get(db, kind, id);
  });
  return run();
}

/** ลบได้ต่อเมื่อไม่มีสินค้าใช้อยู่ ถ้ามีจะโยน AppError พร้อมบอกจำนวนสินค้า */
function remove(db, kind, id) {
  const { table, column, label } = meta(kind);
  const row = get(db, kind, id);
  if (!row) throw new AppError(`ไม่พบ${label}ที่ต้องการลบ`);
  const used = db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${column} = ?`).get(id).n;
  if (used > 0) {
    throw new AppError(
      `ลบ${label} "${row.name}" ไม่ได้ เพราะยังมีสินค้าใช้อยู่ ${used} รายการ ` +
        `กรุณาย้ายหรือลบสินค้าเหล่านั้นก่อน`
    );
  }
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return row;
}

/** จัดลำดับหมวดหมู่ใหม่ทั้งชุดตามลำดับ id ที่ส่งมา (ใช้กับการลากสลับตำแหน่ง) */
function reorderCategories(db, ids) {
  const wanted = (Array.isArray(ids) ? ids : String(ids || '').split(','))
    .map((id) => Number(String(id).trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  const existing = db.prepare('SELECT id FROM categories').all().map((row) => row.id);
  const unique = [...new Set(wanted)];
  if (unique.length !== existing.length || !existing.every((id) => unique.includes(id))) {
    throw new AppError('ลำดับหมวดหมู่ไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  const run = db.transaction(() => {
    const update = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    unique.forEach((id, index) => update.run(index + 1, id));
  });
  run();
  return list(db, 'categories');
}

/** เลื่อนหมวดหมู่ขึ้น/ลงทีละอันดับ (ปุ่มสำรองสำหรับกรณีลากไม่ได้) */
function moveCategory(db, id, direction) {
  if (!['up', 'down'].includes(direction)) throw new AppError('ทิศทางการเลื่อนไม่ถูกต้อง');
  const current = get(db, 'categories', id);
  if (!current) throw new AppError('ไม่พบหมวดหมู่ที่ต้องการเลื่อน');

  const ordered = list(db, 'categories').map((row) => row.id);
  const index = ordered.indexOf(current.id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return list(db, 'categories'); // อยู่บนสุด/ล่างสุดแล้ว

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return reorderCategories(db, ordered);
}

module.exports = { list, get, create, rename, remove, reorderCategories, moveCategory };
