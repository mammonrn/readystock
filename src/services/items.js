'use strict';

const { AppError } = require('../errors');
const { addLog } = require('./logs');
const { formatItemCode, nextSequence } = require('../codes');

const SELECT_ITEM = `
  SELECT i.*,
         c.name AS category_name,
         o.name AS office_name,
         COALESCE(u.username, '-') AS updated_by_name
    FROM items i
    JOIN categories c ON c.id = i.category_id
    JOIN offices o    ON o.id = i.office_id
    LEFT JOIN users u ON u.id = i.updated_by`;

/** แปลง filter จาก query string เป็นเงื่อนไข SQL */
function buildFilter({ q, officeId, categoryId, onlyEmpty } = {}) {
  const where = [];
  const params = [];

  const keyword = String(q || '').trim();
  if (keyword) {
    // ค้นหาได้ทั้งชื่อสินค้าและรหัสสินค้า (LIKE ไม่สนตัวพิมพ์เล็ก-ใหญ่สำหรับตัวอักษร ASCII)
    const pattern = '%' + keyword.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push("(i.name LIKE ? ESCAPE '\\' OR i.item_code LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (officeId) {
    where.push('i.office_id = ?');
    params.push(Number(officeId));
  }
  if (categoryId) {
    where.push('i.category_id = ?');
    params.push(Number(categoryId));
  }
  if (onlyEmpty) where.push('i.quantity = 0');

  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/** ดึงรายการสินค้าตาม filter พร้อมแบ่งหน้า และสรุปยอดรวมของทั้ง filter */
function listItems(db, filter = {}) {
  const perPage = Math.max(1, Number(filter.perPage) || 50);
  const { clause, params } = buildFilter(filter);

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(i.quantity), 0) AS total_quantity,
              COALESCE(SUM(CASE WHEN i.quantity = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock
         FROM items i ${clause}`
    )
    .get(...params);

  const pages = Math.max(1, Math.ceil(summary.total / perPage));
  const page = Math.min(Math.max(1, Number(filter.page) || 1), pages);

  const rows = db
    .prepare(
      `${SELECT_ITEM} ${clause}
        ORDER BY i.name COLLATE NOCASE, i.id
        LIMIT ? OFFSET ?`
    )
    .all(...params, perPage, (page - 1) * perPage);

  return {
    rows,
    total: summary.total,
    totalQuantity: summary.total_quantity,
    outOfStock: summary.out_of_stock,
    page,
    pages,
    perPage,
  };
}

/** ดึงทุกรายการตาม filter (ไม่แบ่งหน้า) — ใช้ตอน export Excel */
function listAllItems(db, filter = {}) {
  const { clause, params } = buildFilter(filter);
  return db.prepare(`${SELECT_ITEM} ${clause} ORDER BY i.name COLLATE NOCASE, i.id`).all(...params);
}

function getItem(db, id) {
  return db.prepare(`${SELECT_ITEM} WHERE i.id = ?`).get(id);
}

function normalize(db, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError('กรุณากรอกชื่อสินค้า');
  if (name.length > 120) throw new AppError('ชื่อสินค้ายาวเกิน 120 ตัวอักษร');

  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) throw new AppError('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  if (quantity > 1_000_000_000) throw new AppError('จำนวนมากเกินไป');

  const categoryId = Number(input.categoryId);
  const officeId = Number(input.officeId);
  if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId)) {
    throw new AppError('กรุณาเลือกหมวดหมู่ให้ถูกต้อง');
  }
  if (!db.prepare('SELECT id FROM offices WHERE id = ?').get(officeId)) {
    throw new AppError('กรุณาเลือกสำนักงานให้ถูกต้อง');
  }

  return {
    name,
    quantity,
    categoryId,
    officeId,
    unit: String(input.unit || '').trim().slice(0, 32),
    note: String(input.note || '').trim().slice(0, 500),
  };
}

/**
 * เพิ่มสินค้าใหม่พร้อมออกรหัสสินค้าอัตโนมัติ เช่น TLP0001
 *
 * ทั้งการหาเลขลำดับถัดไปและการ INSERT อยู่ใน transaction แบบ IMMEDIATE เดียวกัน
 * (better-sqlite3 ทำงานแบบ synchronous จึงไม่มีการสลับกันกลาง transaction ในโปรเซสเดียว
 *  ส่วน IMMEDIATE จะจับ write lock ตั้งแต่ต้น กันกรณีมีหลายโปรเซส/หลาย connection เขียนพร้อมกัน)
 * และยังมี UNIQUE index บน items.item_code เป็นด่านสุดท้าย ถ้าชนจริงจะขยับไปเลขถัดไปแล้วลองใหม่
 */
function createItem(db, input, userId) {
  const v = normalize(db, input);
  const { code_prefix: prefix } = db.prepare('SELECT code_prefix FROM categories WHERE id = ?').get(v.categoryId);

  const insert = db.prepare(
    `INSERT INTO items (item_code, name, category_id, office_id, quantity, unit, note, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    let sequence = nextSequence(db, prefix);
    for (let attempt = 0; attempt < 50; attempt += 1, sequence += 1) {
      try {
        const info = insert.run(
          formatItemCode(prefix, sequence),
          v.name,
          v.categoryId,
          v.officeId,
          v.quantity,
          v.unit,
          v.note,
          userId ?? null
        );
        return getItem(db, info.lastInsertRowid);
      } catch (err) {
        // รหัสถูกใช้ไปแล้ว (เช่นอีกโปรเซสเพิ่งแทรกเข้ามา) ให้ขยับไปเลขถัดไป
        if (!String(err.message).includes('UNIQUE') || !String(err.message).includes('item_code')) throw err;
      }
    }
    throw new AppError('ออกรหัสสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  });

  const item = run.immediate();
  addLog(db, {
    userId,
    action: 'create',
    itemName: item.name,
    detail: `เพิ่มสินค้าใหม่ รหัส ${item.item_code} ที่ ${item.office_name} (${item.category_name}) จำนวน ${item.quantity} ${item.unit || ''}`.trim(),
  });
  return item;
}

function describeChanges(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(`ชื่อ: ${before.name} → ${after.name}`);
  if (before.category_name !== after.category_name) changes.push(`หมวดหมู่: ${before.category_name} → ${after.category_name}`);
  if (before.office_name !== after.office_name) changes.push(`สำนักงาน: ${before.office_name} → ${after.office_name}`);
  if (before.quantity !== after.quantity) changes.push(`จำนวน: ${before.quantity} → ${after.quantity}`);
  if (before.unit !== after.unit) changes.push(`หน่วย: ${before.unit || '-'} → ${after.unit || '-'}`);
  if (before.note !== after.note) changes.push(`หมายเหตุ: ${before.note || '-'} → ${after.note || '-'}`);
  return changes;
}

/** แก้ไขสินค้า — item_code เดิมคงเดิมเสมอ แม้จะย้ายไปหมวดหมู่อื่น */
function updateItem(db, id, input, userId) {
  const before = getItem(db, id);
  if (!before) throw new AppError('ไม่พบสินค้าที่ต้องการแก้ไข');
  const v = normalize(db, input);

  db.prepare(
    `UPDATE items
        SET name = ?, category_id = ?, office_id = ?, quantity = ?, unit = ?, note = ?,
            updated_at = datetime('now'), updated_by = ?
      WHERE id = ?`
  ).run(v.name, v.categoryId, v.officeId, v.quantity, v.unit, v.note, userId ?? null, id);

  const after = getItem(db, id);
  const changes = describeChanges(before, after);
  addLog(db, {
    userId,
    action: 'update',
    itemName: after.name,
    detail: changes.length ? changes.join(', ') : 'บันทึกโดยไม่มีการเปลี่ยนแปลง',
  });
  return after;
}

function deleteItem(db, id, userId) {
  const item = getItem(db, id);
  if (!item) throw new AppError('ไม่พบสินค้าที่ต้องการลบ');
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  addLog(db, {
    userId,
    action: 'delete',
    itemName: item.name,
    detail: `ลบสินค้ารหัส ${item.item_code} ออกจาก ${item.office_name} (${item.category_name}) จำนวนคงเหลือ ${item.quantity} ${item.unit || ''}`.trim(),
  });
  return item;
}

module.exports = { listItems, listAllItems, getItem, createItem, updateItem, deleteItem, buildFilter };
