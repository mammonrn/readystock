'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { uniquePrefix, formatItemCode, nextSequence } = require('./codes');

const DEFAULT_OFFICES = ['SH666', 'SH999', 'UB89', '88F'];
const DEFAULT_CATEGORIES = [
  { name: 'โทรศัพท์', codePrefix: 'TLP' },
  { name: 'คอมพิวเตอร์', codePrefix: 'COM' },
  { name: 'อื่นๆ', codePrefix: 'OTH' },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  code_prefix TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code   TEXT,
  name        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  office_id   INTEGER NOT NULL REFERENCES offices(id),
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_items_name     ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_office   ON items(office_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  item_name  TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS invite_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** เพิ่มคอลัมน์ให้ฐานข้อมูลเดิมที่สร้างไว้ก่อนหน้า (ถ้ายังไม่มีคอลัมน์นั้น) */
function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

/**
 * เติมค่าให้แถวเดิมที่ยังไม่มี code_prefix / sort_order / item_code
 * (ฐานข้อมูลที่สร้างก่อนมีฟีเจอร์รหัสสินค้าและการจัดลำดับหมวดหมู่)
 */
function backfill(db) {
  const fill = db.transaction(() => {
    const categories = db.prepare('SELECT id, name, code_prefix, sort_order FROM categories ORDER BY id').all();

    categories.forEach((category, index) => {
      if (!category.code_prefix) {
        // หมวดหมู่ตั้งต้นให้ใช้ prefix ชุดเดียวกับที่ seed ไว้ (TLP / COM / OTH)
        const preset = DEFAULT_CATEGORIES.find((c) => c.name === category.name);
        db.prepare('UPDATE categories SET code_prefix = ? WHERE id = ?').run(
          uniquePrefix(db, category.name, { base: preset ? preset.codePrefix : undefined, excludeId: category.id }),
          category.id
        );
      }
      if (!category.sort_order) {
        db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(index + 1, category.id);
      }
    });

    const pending = db
      .prepare('SELECT i.id, c.code_prefix FROM items i JOIN categories c ON c.id = i.category_id WHERE i.item_code IS NULL ORDER BY i.id')
      .all();
    for (const item of pending) {
      db.prepare('UPDATE items SET item_code = ? WHERE id = ?').run(
        formatItemCode(item.code_prefix, nextSequence(db, item.code_prefix)),
        item.id
      );
    }
  });
  fill();
}

/** สร้าง schema (idempotent) + ใส่ข้อมูลตั้งต้นถ้าตารางยังว่าง */
function migrate(db) {
  db.exec(SCHEMA);

  addColumnIfMissing(db, 'categories', 'code_prefix', 'TEXT');
  addColumnIfMissing(db, 'categories', 'sort_order', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'items', 'item_code', 'TEXT');

  // index สองตัวนี้ต้องสร้างหลังเพิ่มคอลัมน์ ไม่ใช่ใน SCHEMA
  // เพราะฐานข้อมูลเดิมจะข้าม CREATE TABLE ไป ทำให้ยังไม่มีคอลัมน์ตอนสร้าง index
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_prefix ON categories(code_prefix);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
  `);

  if (db.prepare('SELECT COUNT(*) AS n FROM offices').get().n === 0) {
    const seedOffice = db.prepare('INSERT OR IGNORE INTO offices (name) VALUES (?)');
    for (const name of DEFAULT_OFFICES) seedOffice.run(name);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    const seedCategory = db.prepare(
      'INSERT OR IGNORE INTO categories (name, code_prefix, sort_order) VALUES (?, ?, ?)'
    );
    DEFAULT_CATEGORIES.forEach((category, index) => seedCategory.run(category.name, category.codePrefix, index + 1));
  }

  backfill(db);
  return db;
}

/**
 * เปิดฐานข้อมูล SQLite แล้วเตรียม schema ให้พร้อมใช้งาน
 * @param {string} file path ของไฟล์ฐานข้อมูล หรือ ':memory:' สำหรับเทสต์
 */
function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'readystock.sqlite')) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // เผื่อกรณีมีหลาย connection เขียนพร้อมกัน ให้รอคิวแทนที่จะ error ทันที
  db.pragma('busy_timeout = 5000');
  return migrate(db);
}

module.exports = { openDb, migrate, DEFAULT_OFFICES, DEFAULT_CATEGORIES };
