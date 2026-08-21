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

test('รหัสสินค้า: ลบสินค้าที่เลขสูงสุดทิ้ง แล้วเพิ่มใหม่ต้องได้เลขถัดไป ไม่ใช่เลขที่เพิ่งลบ', () => {
  const { db, user, add } = setup();
  add('ของ 1');
  add('ของ 2');
  const third = add('ของ 3');
  assert.equal(third.item_code, 'TLP0003');

  items.deleteItem(db, third.id, user.id);
  const next = add('ของ 4');
  assert.equal(next.item_code, 'TLP0004', 'ต้องเดินหน้าต่อ ไม่กลับไปใช้ TLP0003 ที่เพิ่งลบไป');
  assert.notEqual(next.item_code, third.item_code);
  db.close();
});

test('รหัสสินค้า: ลบสินค้าทั้งหมดในหมวดแล้วเพิ่มใหม่ ตัวนับก็ยังเดินหน้าต่อ', () => {
  const { db, user, add } = setup();
  const created = [add('ของ 1'), add('ของ 2'), add('ของ 3')];
  for (const item of created) items.deleteItem(db, item.id, user.id);
  assert.equal(items.listItems(db).total, 0);

  assert.equal(add('ของใหม่').item_code, 'TLP0004', 'ตัวนับไม่ถอยหลังแม้ในหมวดจะไม่เหลือสินค้าเลย');
  assert.equal(codes.currentCounter(db, 'TLP'), 4);
  db.close();
});

test('รหัสสินค้า: ตัวนับเก็บแยกตาม prefix และเดินหน้าอย่างเดียว', () => {
  const { db, computer, add } = setup();
  assert.equal(codes.currentCounter(db, 'TLP'), 0, 'prefix ที่ยังไม่เคยใช้ต้องเริ่มที่ 0');

  add('ของ 1');
  add('ของ 2');
  assert.equal(codes.currentCounter(db, 'TLP'), 2);
  assert.equal(codes.currentCounter(db, 'COM'), 0, 'ตัวนับของแต่ละ prefix แยกกัน');

  add('คอม 1', computer);
  assert.equal(codes.currentCounter(db, 'COM'), 1);
  assert.equal(codes.currentCounter(db, 'TLP'), 2);
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

/**
 * db ปลอมที่แกล้งจองเลขได้ค่าเก่าใน 3 ครั้งแรก
 * เหมือนกรณีที่รหัสนั้นถูกใช้ไปแล้ว (เช่นข้อมูลเก่าที่ออกรหัสไว้ก่อนมีตัวนับ)
 * ใช้ตรวจว่า createItem จะจองเลขใหม่แล้วลองใหม่จนสำเร็จ ไม่ใช่โยน error ออกมา
 */
function staleDb(db, staleValues = [1, 2, 3]) {
  const queue = [...staleValues];
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql) => {
          const statement = target.prepare(sql);
          if (!sql.includes('prefix_counters') || !sql.includes('RETURNING')) return statement;
          return {
            // ระหว่างที่ยังมีค่าเก่าค้างอยู่ ให้คืนค่าเก่าโดยไม่แตะตัวนับจริง
            get: (...args) => (queue.length ? { last_number: queue.shift() } : statement.get(...args)),
          };
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('race condition: ถ้าเลขที่จองได้ถูกใช้ไปแล้ว ต้องจองเลขใหม่แทนที่จะพัง', () => {
  const { db, user, office, phone, add } = setup();
  add('ของ 1');
  add('ของ 2');
  add('ของ 3');

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

// ---------- ตัวนับผูกกับ prefix ไม่ใช่หมวดหมู่ ----------

test('เปลี่ยน prefix ของหมวดหมู่: prefix ใหม่ที่ยังไม่เคยถูกใช้ ต้องเริ่มนับที่ 1', () => {
  const { db, phone, add } = setup();
  add('ของ 1');
  add('ของ 2');
  assert.equal(codes.currentCounter(db, 'TLP'), 2);

  taxonomy.rename(db, 'categories', phone, 'โทรศัพท์', { codePrefix: 'PHN' });
  assert.equal(codes.currentCounter(db, 'PHN'), 0, 'prefix ใหม่ยังไม่เคยถูกใช้ ต้องเริ่มที่ 0');
  assert.equal(add('ของ 3').item_code, 'PHN0001');
  assert.equal(codes.currentCounter(db, 'TLP'), 2, 'ตัวนับของ prefix เดิมต้องไม่ถูกแตะ');
  db.close();
});

test('เปลี่ยน prefix ไปใช้ prefix ที่เคยมีสินค้าใช้อยู่ก่อนแล้ว ต้องนับต่อจากของเดิม', () => {
  const { db, phone, computer, add } = setup();
  add('มือถือ 1', phone);
  add('มือถือ 2', phone);
  add('คอม 1', computer);
  assert.equal(codes.currentCounter(db, 'TLP'), 2);

  // ย้าย prefix ของหมวดโทรศัพท์ไปเป็น PHN เพื่อปล่อย TLP ให้ว่าง
  taxonomy.rename(db, 'categories', phone, 'โทรศัพท์', { codePrefix: 'PHN' });
  // แล้วให้หมวดคอมพิวเตอร์มาใช้ TLP แทน
  taxonomy.rename(db, 'categories', computer, 'คอมพิวเตอร์', { codePrefix: 'TLP' });

  const item = add('คอม 2', computer);
  assert.equal(item.item_code, 'TLP0003', 'ต้องนับต่อจากตัวนับเดิมของ TLP ไม่ใช่เริ่มใหม่ที่ 1');
  assert.equal(items.listItems(db, { q: 'TLP0001' }).rows[0].name, 'มือถือ 1', 'TLP0001 ยังเป็นของเดิม');
  assert.equal(new Set(items.listItems(db).rows.map((r) => r.item_code)).size, 4, 'ทุกรหัสต้องไม่ซ้ำกัน');
  db.close();
});

test('สองหมวดหมู่ใช้ prefix เดียวกันคนละช่วงเวลา: รหัสต้องไม่ชนกันข้ามหมวดหมู่', () => {
  const { db, user, office, phone, add } = setup();
  add('มือถือ 1');
  add('มือถือ 2');

  // ปล่อย prefix TLP ให้ว่าง แล้วสร้างหมวดหมู่ใหม่มาใช้ TLP ต่อ
  taxonomy.rename(db, 'categories', phone, 'โทรศัพท์', { codePrefix: 'PHN' });
  const reuse = taxonomy.create(db, 'categories', 'อุปกรณ์เสริมมือถือ', { codePrefix: 'TLP' });

  const first = items.createItem(db, { name: 'เคส', quantity: 1, categoryId: reuse.id, officeId: office }, user.id);
  const second = items.createItem(db, { name: 'ฟิล์ม', quantity: 1, categoryId: reuse.id, officeId: office }, user.id);

  assert.equal(first.item_code, 'TLP0003', 'หมวดใหม่ต้องนับต่อจากเลขที่ prefix นี้เคยออกไปแล้ว');
  assert.equal(second.item_code, 'TLP0004');

  const all = items.listItems(db).rows.map((r) => r.item_code);
  assert.equal(new Set(all).size, all.length, 'รหัสทั้งระบบต้องไม่ซ้ำกัน');
  assert.deepEqual([...all].sort(), ['TLP0001', 'TLP0002', 'TLP0003', 'TLP0004']);
  db.close();
});

test('ลบหมวดหมู่แล้วสร้างใหม่ด้วย prefix เดิม ตัวนับต้องไม่ถูกรีเซ็ต', () => {
  const { db, user, office } = setup();
  const temp = taxonomy.create(db, 'categories', 'ชั่วคราว', { codePrefix: 'TMP' });
  const item = items.createItem(db, { name: 'ของ', quantity: 1, categoryId: temp.id, officeId: office }, user.id);
  assert.equal(item.item_code, 'TMP0001');

  items.deleteItem(db, item.id, user.id);
  taxonomy.remove(db, 'categories', temp.id);

  const again = taxonomy.create(db, 'categories', 'ชั่วคราวรอบสอง', { codePrefix: 'TMP' });
  const newItem = items.createItem(db, { name: 'ของใหม่', quantity: 1, categoryId: again.id, officeId: office }, user.id);
  assert.equal(newItem.item_code, 'TMP0002', 'ตัวนับของ prefix ต้องอยู่รอดแม้หมวดหมู่จะถูกลบไปแล้ว');
  db.close();
});

test('อัปเกรดฐานข้อมูลเดิม: ตัวนับต้องถูกตั้งให้ไม่ต่ำกว่ารหัสสูงสุดที่เคยออกไปแล้ว', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readystock-counter-'));
  const file = path.join(dir, 'old.sqlite');

  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE offices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      code_prefix TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT, name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id), office_id INTEGER NOT NULL REFERENCES offices(id),
      quantity INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id));
    INSERT INTO offices (name) VALUES ('SH666');
    INSERT INTO categories (name, code_prefix, sort_order) VALUES ('โทรศัพท์', 'TLP', 1), ('คอมพิวเตอร์', 'COM', 2);
    INSERT INTO items (item_code, name, category_id, office_id, quantity) VALUES
      ('TLP0001', 'ของเก่า 1', 1, 1, 5), ('TLP0007', 'ของเก่า 2', 1, 1, 2), ('COM0003', 'ของเก่า 3', 2, 1, 1);
  `);
  old.close();

  const db = openDb(file);
  assert.equal(codes.currentCounter(db, 'TLP'), 7, 'ต้องตั้งตัวนับตามรหัสสูงสุดที่เคยออก');
  assert.equal(codes.currentCounter(db, 'COM'), 3);

  const user = makeUser(db, 'boss');
  const office = db.prepare("SELECT id FROM offices WHERE name = 'SH666'").get().id;
  const created = items.createItem(db, { name: 'ของใหม่', quantity: 1, categoryId: 1, officeId: office }, user.id);
  assert.equal(created.item_code, 'TLP0008', 'สินค้าใหม่ต้องไม่ไปชนรหัสเดิม');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('อัปเกรดฐานข้อมูลเดิม: prefix ที่ไม่ได้ผูกกับหมวดหมู่ไหนแล้ว ก็ต้องกันรหัสซ้ำด้วย', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readystock-orphan-'));
  const file = path.join(dir, 'old.sqlite');

  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE offices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      code_prefix TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT, name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id), office_id INTEGER NOT NULL REFERENCES offices(id),
      quantity INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by INTEGER REFERENCES users(id));
    INSERT INTO offices (name) VALUES ('SH666');
    -- หมวดหมู่ใช้ prefix PHN อยู่ แต่มีสินค้าเก่าที่ยังถือรหัส TLP อยู่ (เคยเปลี่ยน prefix มาก่อน)
    INSERT INTO categories (name, code_prefix, sort_order) VALUES ('โทรศัพท์', 'PHN', 1);
    INSERT INTO items (item_code, name, category_id, office_id, quantity) VALUES
      ('TLP0001', 'ของเก่า 1', 1, 1, 5), ('TLP0005', 'ของเก่า 2', 1, 1, 2), ('TLP20003', 'ของเก่า 3', 1, 1, 1);
  `);
  old.close();

  const db = openDb(file);
  assert.equal(codes.currentCounter(db, 'TLP'), 5, 'ตัวนับของ prefix ที่ไม่มีหมวดหมู่แล้วก็ต้องถูกตั้งไว้');
  assert.equal(codes.currentCounter(db, 'TLP2'), 3, 'prefix ที่ลงท้ายด้วยตัวเลขต้องแยกออกถูกต้อง');

  // ถ้ามีหมวดหมู่มาใช้ TLP อีกครั้ง ต้องนับต่อจากของเดิม ไม่ชนรหัสเก่า
  const user = makeUser(db, 'boss');
  const office = db.prepare("SELECT id FROM offices WHERE name = 'SH666'").get().id;
  const reuse = taxonomy.create(db, 'categories', 'อุปกรณ์เสริม', { codePrefix: 'TLP' });
  const created = items.createItem(db, { name: 'ของใหม่', quantity: 1, categoryId: reuse.id, officeId: office }, user.id);
  assert.equal(created.item_code, 'TLP0006');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
