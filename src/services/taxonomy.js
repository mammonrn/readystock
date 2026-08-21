'use strict';

const { AppError } = require('./users');

// ตาราง offices และ categories ใช้โครงสร้างเหมือนกัน จึงใช้ฟังก์ชันชุดเดียวกันได้
const TABLES = {
  offices: { table: 'offices', column: 'office_id', label: 'สำนักงาน' },
  categories: { table: 'categories', column: 'category_id', label: 'หมวดหมู่' },
};

function meta(kind) {
  const m = TABLES[kind];
  if (!m) throw new AppError('ประเภทข้อมูลไม่ถูกต้อง');
  return m;
}

function list(db, kind) {
  const { table, column } = meta(kind);
  return db
    .prepare(
      `SELECT t.id, t.name, t.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.${column} = t.id) AS item_count
         FROM ${table} t
        ORDER BY t.name COLLATE NOCASE`
    )
    .all();
}

function create(db, kind, name) {
  const { table, label } = meta(kind);
  const value = String(name || '').trim();
  if (!value) throw new AppError(`กรุณากรอกชื่อ${label}`);
  if (value.length > 64) throw new AppError(`ชื่อ${label}ยาวเกิน 64 ตัวอักษร`);
  const dup = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(value);
  if (dup) throw new AppError(`มี${label} "${value}" อยู่แล้ว`);
  const info = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(value);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
}

function rename(db, kind, id, name) {
  const { table, label } = meta(kind);
  const value = String(name || '').trim();
  if (!value) throw new AppError(`กรุณากรอกชื่อ${label}`);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new AppError(`ไม่พบ${label}ที่ต้องการแก้ไข`);
  const dup = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND id <> ?`).get(value, id);
  if (dup) throw new AppError(`มี${label} "${value}" อยู่แล้ว`);
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(value, id);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

/** ลบได้ต่อเมื่อไม่มีสินค้าใช้อยู่ ถ้ามีจะโยน AppError พร้อมบอกจำนวนสินค้า */
function remove(db, kind, id) {
  const { table, column, label } = meta(kind);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
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

module.exports = { list, create, rename, remove };
