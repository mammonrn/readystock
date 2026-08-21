'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_OFFICES = ['SH666', 'SH999', 'UB89', '88F'];
const DEFAULT_CATEGORIES = ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ'];

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
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
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

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

/** สร้าง schema (idempotent) + ใส่ข้อมูลตั้งต้นถ้าตารางยังว่าง */
function migrate(db) {
  db.exec(SCHEMA);

  const seedOffice = db.prepare('INSERT OR IGNORE INTO offices (name) VALUES (?)');
  const seedCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');

  if (db.prepare('SELECT COUNT(*) AS n FROM offices').get().n === 0) {
    for (const name of DEFAULT_OFFICES) seedOffice.run(name);
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
    for (const name of DEFAULT_CATEGORIES) seedCategory.run(name);
  }
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
  return migrate(db);
}

module.exports = { openDb, migrate, DEFAULT_OFFICES, DEFAULT_CATEGORIES };
