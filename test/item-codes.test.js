'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { freshDb, makeUser } = require('./helpers');
const { openDb } = require('../src/db');
const codes = require('../src/codes');
const items = require('../src/services/items');
const taxonomy = require('../src/services/taxonomy');

function setup() {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const office = db.prepare("SELECT id FROM offices WHERE name = 'SH666'").get().id;
  const phone = db.prepare("SELECT id FROM categories WHERE name = 'โทรศัพท์'").get().id;
  const computer = db.prepare("SELECT id FROM categories WHERE name = 'คอมพิวเตอร์'").get().id;
  const add = (name, categoryId = phone) =>
    items.createItem(db, { name, quantity: 1, categoryId, officeId: office }, user.id);
  return { db, user, office, phone, computer, add };
}

// ---------- การสร้าง prefix ของหมวดหมู่ ----------

test('prefix: ชื่ออังกฤษใช้ 3 ตัวแรกเป็นตัวพิมพ์ใหญ่ ตัดอักขระที่ไม่ใช่ตัวอักษร/ตัวเลขออกก่อน', () => {
  assert.equal(codes.makeBasePrefix('Furniture'), 'FUR');
  assert.equal(codes.makeBasePrefix('  office supply '), 'OFF');
  assert.equal(codes.makeBasePrefix('A/C unit'), 'ACU');
  assert.equal(codes.makeBasePrefix('3M tape'), '3MT');
});

test('prefix: ชื่อไทยถอดเป็นอักษรโรมันให้อัตโนมัติ', () => {
  assert.equal(codes.makeBasePrefix('โทรศัพท์'), 'TRS');
  assert.equal(codes.makeBasePrefix('คอมพิวเตอร์'), 'KOM');
  assert.equal(codes.makeBasePrefix('เครื่องเขียน'), 'KRO');
  assert.match(codes.makeBasePrefix('อื่นๆ'), /^[A-Z0-9]{2,3}$/);
});

test('prefix: ชื่อที่สั้นหรือไม่มีตัวอักษรเลย ใช้ค่าสำรอง CAT', () => {
  assert.equal(codes.makeBasePrefix('ก'), 'CAT');
  assert.equal(codes.makeBasePrefix('!!!'), 'CAT');
  assert.equal(codes.makeBasePrefix(''), 'CAT');
  assert.equal(codes.makeBasePrefix('AI'), 'AI', 'ชื่อ 2 ตัวอักษรใช้ได้ตามนั้น');
});

test('prefix: ชนกันต้องต่อเลขท้ายให้ไม่ซ้ำ (TLP, TLP2, TLP3, ...)', () => {
  const db = freshDb();
  const first = taxonomy.create(db, 'categories', 'Telephone accessories');
  const second = taxonomy.create(db, 'categories', 'Telephone case');
  const third = taxonomy.create(db, 'categories', 'Telephone cable');

  assert.equal(first.code_prefix, 'TEL');
  assert.equal(second.code_prefix, 'TEL2');
  assert.equal(third.code_prefix, 'TEL3');
  assert.equal(new Set([first, second, third].map((c) => c.code_prefix)).size, 3);
  db.close();
});

test('prefix: ชนกับ prefix ของหมวดหมู่ตั้งต้นก็ต้องต่อเลขให้เช่นกัน', () => {
  const db = freshDb();
  // หมวดหมู่ตั้งต้นใช้ TLP / COM / OTH อยู่แล้ว
  assert.equal(taxonomy.create(db, 'categories', 'Computer parts').code_prefix, 'COM2');
  assert.equal(taxonomy.create(db, 'categories', 'Computer bags').code_prefix, 'COM3');
  db.close();
});

test('prefix: แอดมินระบุเองได้ และห้ามซ้ำกับหมวดหมู่อื่น', () => {
  const db = freshDb();
  const category = taxonomy.create(db, 'categories', 'เครื่องเขียน', { codePrefix: 'sta' });
  assert.equal(category.code_prefix, 'STA', 'ต้องแปลงเป็นตัวพิมพ์ใหญ่ให้');

  assert.throws(() => taxonomy.create(db, 'categories', 'อีกหมวด', { codePrefix: 'TLP!' }), /ถูกใช้กับหมวดหมู่/);
  assert.throws(() => taxonomy.create(db, 'categories', 'อีกหมวด', { codePrefix: 'X' }), /2-8 ตัวอักษร/);
  db.close();
});

test('prefix: แก้ไขภายหลังได้ แต่รหัสสินค้าที่ออกไปแล้วต้องไม่เปลี่ยน', () => {
  const { db, phone, add } = setup();
  const item = add('iPhone 15');
  assert.equal(item.item_code, 'TLP0001');

  taxonomy.rename(db, 'categories', phone, 'โทรศัพท์มือถือ', { codePrefix: 'PHN' });
  assert.equal(items.getItem(db, item.id).item_code, 'TLP0001', 'รหัสเดิมต้องคงเดิม');
  assert.equal(add('iPhone 16').item_code, 'PHN0001', 'สินค้าใหม่ใช้ prefix ใหม่');
  db.close();
});

// ---------- การออกรหัสสินค้า ----------

test('รหัสสินค้า: ออกเป็น {prefix}0001 เรียงต่อกันไป', () => {
  const { db, add } = setup();
  assert.equal(add('ของ 1').item_code, 'TLP0001');
  assert.equal(add('ของ 2').item_code, 'TLP0002');
  assert.equal(add('ของ 3').item_code, 'TLP0003');
  db.close();
});

test('รหัสสินค้า: เลขนับแยกอิสระต่อหมวดหมู่ ไม่นับรวมทั้งระบบ', () => {
  const { db, phone, computer, add } = setup();
  assert.equal(add('มือถือ 1', phone).item_code, 'TLP0001');
  assert.equal(add('คอม 1', computer).item_code, 'COM0001');
  assert.equal(add('มือถือ 2', phone).item_code, 'TLP0002');
  assert.equal(add('คอม 2', computer).item_code, 'COM0002');
  assert.equal(add('คอม 3', computer).item_code, 'COM0003');
  assert.equal(add('มือถือ 3', phone).item_code, 'TLP0003');
  db.close();
});

test('รหัสสินค้า: ย้ายหมวดหมู่แล้วรหัสเดิมคงเดิม และไม่ไปกวนเลขของหมวดหมู่ใหม่', () => {
  const { db, user, office, phone, computer, add } = setup();
  const item = add('iPhone 15', phone);
  add('Macbook', computer);
  assert.equal(item.item_code, 'TLP0001');

  const moved = items.updateItem(
    db,
    item.id,
    { name: item.name, quantity: 1, categoryId: computer, officeId: office },
    user.id
  );
  assert.equal(moved.item_code, 'TLP0001', 'ย้ายหมวดหมู่แล้วรหัสต้องไม่ถูกออกใหม่');
  assert.equal(moved.category_name, 'คอมพิวเตอร์');

  assert.equal(add('จอคอม', computer).item_code, 'COM0002', 'หมวดหมู่ใหม่นับต่อจากของเดิมของตัวเอง');
  assert.equal(add('iPhone 16', phone).item_code, 'TLP0002', 'หมวดเดิมต้องไม่นำเลขของที่ย้ายออกไปมาใช้ซ้ำ');
  db.close();
});

test('รหัสสินค้า: เลขนับจากสินค้าที่มีอยู่จริง ลบตัวล่าสุดแล้วเลขนั้นถูกนำกลับมาใช้ใหม่', () => {
  const { db, user, add } = setup();
  add('ของ 1');
  const second = add('ของ 2');
  const third = add('ของ 3');
  assert.equal(third.item_code, 'TLP0003');

  // ลบตัวกลาง: เลขสูงสุดยังเป็น 3 อยู่ ตัวถัดไปจึงเป็น 4 (ไม่ไปเติมช่องว่างตรงกลาง)
  items.deleteItem(db, second.id, user.id);
  assert.equal(add('ของ 4').item_code, 'TLP0004');

  // ลบตัวที่เลขสูงสุด: เลขนั้นว่างลงและถูกนำกลับมาใช้กับสินค้าใหม่
  items.deleteItem(db, items.listItems(db, { q: 'TLP0004' }).rows[0].id, user.id);
  assert.equal(add('ของ 5').item_code, 'TLP0004');
  assert.equal(items.listItems(db).rows.filter((r) => r.item_code === 'TLP0004').length, 1, 'ต้องมีรหัสนี้แค่ตัวเดียว');
  db.close();
});

test('รหัสสินค้า: unique index กันรหัสซ้ำในระดับฐานข้อมูล', () => {
  const { db, add } = setup();
  const item = add('ของ 1');
  assert.throws(
    () => db.prepare('UPDATE items SET item_code = ? WHERE id = ?').run(item.item_code, add('ของ 2').id),
    /UNIQUE/
  );
  db.close();
});

test('รหัสสินค้า: prefix ที่ขึ้นต้นเหมือนกันต้องไม่นับเลขปนกัน (TLP กับ TLP2)', () => {
  const { db, user, office, add } = setup();
  const clash = taxonomy.create(db, 'categories', 'Telephone', { codePrefix: 'TLP2' });

  assert.equal(add('มือถือ 1').item_code, 'TLP0001');
  const other = items.createItem(db, { name: 'เคส', quantity: 1, categoryId: clash.id, officeId: office }, user.id);
  assert.equal(other.item_code, 'TLP20001');

  assert.equal(add('มือถือ 2').item_code, 'TLP0002', 'TLP20001 ต้องไม่ถูกนับเป็นเลขของ TLP');
  assert.equal(
    items.createItem(db, { name: 'เคส 2', quantity: 1, categoryId: clash.id, officeId: office }, user.id).item_code,
    'TLP20002'
  );
  db.close();
});

test('รหัสสินค้า: เพิ่มสินค้ารวดเดียว 200 รายการ ต้องได้รหัสไม่ซ้ำและเรียงต่อเนื่อง', () => {
  const { db, add } = setup();
  const created = [];
  for (let i = 0; i < 200; i += 1) created.push(add(`ของ ${i}`).item_code);

  assert.equal(new Set(created).size, 200);
  assert.equal(created[0], 'TLP0001');
  assert.equal(created[199], 'TLP0200');
  db.close();
});

// ---------- กันรหัสชนกันเมื่อมีการเขียนพร้อมกัน ----------

/** db ปลอมที่แกล้งอ่านเลขลำดับล่าสุดได้ค่าเก่า เหมือนมีอีกโปรเซสแทรกเข้ามาหลังเราอ่านไปแล้ว */
function staleDb(db) {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql) => {
          if (sql.includes('MAX(CAST(SUBSTR(item_code')) return { get: () => ({ n: 0 }) };
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('race condition: ถ้าเลขที่คำนวณได้ถูกใช้ไปแล้ว ต้องขยับไปเลขถัดไปแทนที่จะพัง', () => {
  const { db, user, office, phone, add } = setup();
  add('ของ 1');
  add('ของ 2');
  add('ของ 3');

  // เขียนสินค้าใหม่โดยอ่านเลขล่าสุดได้ค่าเก่า (จำลองอีกโปรเซสแทรกเข้ามาก่อน)
  const item = items.createItem(
    staleDb(db),
    { name: 'ของ 4', quantity: 1, categoryId: phone, officeId: office },
    user.id
  );
  assert.equal(item.item_code, 'TLP0004', 'ต้องข้ามรหัสที่ชนแล้วไปใช้เลขว่างถัดไป');
  assert.equal(items.listItems(db).total, 4);
  db.close();
});

test('race condition: สองการเชื่อมต่อเขียนไฟล์ฐานข้อมูลเดียวกันสลับกัน ต้องไม่ได้รหัสซ้ำ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readystock-race-'));
  const file = path.join(dir, 'race.sqlite');

  const first = openDb(file);
  makeUser(first, 'boss');
  const second = openDb(file);

  const office = first.prepare("SELECT id FROM offices WHERE name = 'SH666'").get().id;
  const phone = first.prepare("SELECT id FROM categories WHERE name = 'โทรศัพท์'").get().id;
  const user = first.prepare("SELECT id FROM users WHERE username = 'boss'").get().id;

  const created = [];
  for (let i = 0; i < 15; i += 1) {
    const connection = i % 2 === 0 ? first : second;
    created.push(
      items.createItem(connection, { name: `ของ ${i}`, quantity: 1, categoryId: phone, officeId: office }, user)
        .item_code
    );
  }

  assert.equal(new Set(created).size, 15, 'ทุกรหัสต้องไม่ซ้ำกัน');
  assert.deepEqual(
    [...created].sort(),
    Array.from({ length: 15 }, (_, i) => `TLP${String(i + 1).padStart(4, '0')}`)
  );

  first.close();
  second.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- ค้นหาด้วยรหัสสินค้า ----------

test('ค้นหา: ใช้ได้ทั้งชื่อและรหัสสินค้า และค้นด้วยรหัสบางส่วนได้', () => {
  const { db, phone, computer, add } = setup();
  add('iPhone 15', phone);
  add('iPhone 14', phone);
  add('Macbook Air', computer);

  assert.deepEqual(items.listItems(db, { q: 'TLP0001' }).rows.map((r) => r.name), ['iPhone 15']);
  assert.equal(items.listItems(db, { q: 'TLP' }).total, 2, 'ค้นด้วย prefix ได้ทั้งหมวด');
  assert.equal(items.listItems(db, { q: 'tlp000' }).total, 2, 'ไม่สนตัวพิมพ์เล็ก-ใหญ่');
  assert.equal(items.listItems(db, { q: '0001' }).total, 2, 'ค้นด้วยเลขท้ายบางส่วนได้');
  assert.equal(items.listItems(db, { q: 'COM' }).total, 1);
  assert.equal(items.listItems(db, { q: 'iphone' }).total, 2, 'ค้นด้วยชื่อยังทำงานเหมือนเดิม');
  assert.equal(items.listItems(db, { q: 'ZZZ9999' }).total, 0);
  db.close();
});

test('ค้นหา: รวมกับตัวกรองสำนักงาน/หมวดหมู่ได้ตามปกติ', () => {
  const { db, phone, computer, add } = setup();
  add('iPhone 15', phone);
  add('Macbook', computer);

  assert.equal(items.listItems(db, { q: 'TLP', categoryId: computer }).total, 0);
  assert.equal(items.listItems(db, { q: 'TLP', categoryId: phone }).total, 1);
  db.close();
});

// ---------- ฐานข้อมูลเดิมที่สร้างไว้ก่อนมีฟีเจอร์นี้ ----------

test('อัปเกรดฐานข้อมูลเดิม: เพิ่มคอลัมน์ใหม่ เติม prefix / ลำดับ / รหัสสินค้าให้ครบ', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readystock-upgrade-'));
  const file = path.join(dir, 'old.sqlite');

  // จำลอง schema เวอร์ชันเก่า (ยังไม่มี code_prefix / sort_order / item_code)
  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE offices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id), office_id INTEGER NOT NULL REFERENCES offices(id),
      quantity INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id));
    INSERT INTO offices (name) VALUES ('SH666');
    INSERT INTO categories (name) VALUES ('โทรศัพท์'), ('คอมพิวเตอร์'), ('อื่นๆ'), ('Furniture');
    INSERT INTO items (name, category_id, office_id, quantity) VALUES
      ('ของเก่า 1', 1, 1, 5), ('ของเก่า 2', 2, 1, 2), ('ของเก่า 3', 1, 1, 1);
  `);
  old.close();

  const db = openDb(file);
  const categories = taxonomy.list(db, 'categories');

  assert.deepEqual(categories.map((c) => c.sort_order), [1, 2, 3, 4], 'ต้องเติมลำดับตาม id เดิม');
  assert.deepEqual(
    categories.filter((c) => ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ'].includes(c.name)).map((c) => c.code_prefix),
    ['TLP', 'COM', 'OTH'],
    'หมวดหมู่ตั้งต้นต้องได้ prefix ชุดเดิม'
  );
  assert.equal(categories.find((c) => c.name === 'Furniture').code_prefix, 'FUR');
  assert.equal(new Set(categories.map((c) => c.code_prefix)).size, 4, 'prefix ต้องไม่ซ้ำกัน');

  assert.deepEqual(
    db.prepare('SELECT item_code FROM items ORDER BY id').all().map((r) => r.item_code),
    ['TLP0001', 'COM0001', 'TLP0002'],
    'สินค้าเดิมต้องได้รหัสตามหมวดหมู่ของตัวเอง'
  );

  // เปิดซ้ำอีกครั้งต้องไม่เปลี่ยนอะไร (migrate ต้องทำซ้ำได้)
  db.close();
  const again = openDb(file);
  assert.deepEqual(
    again.prepare('SELECT item_code FROM items ORDER BY id').all().map((r) => r.item_code),
    ['TLP0001', 'COM0001', 'TLP0002']
  );
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
