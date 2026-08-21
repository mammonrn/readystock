'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser } = require('./helpers');
const items = require('../src/services/items');
const logs = require('../src/services/logs');

function ids(db) {
  return {
    office: db.prepare("SELECT id FROM offices WHERE name = 'SH666'").get().id,
    office2: db.prepare("SELECT id FROM offices WHERE name = 'UB89'").get().id,
    phone: db.prepare("SELECT id FROM categories WHERE name = 'โทรศัพท์'").get().id,
    computer: db.prepare("SELECT id FROM categories WHERE name = 'คอมพิวเตอร์'").get().id,
  };
}

function setup() {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  return { db, user, ...ids(db) };
}

test('เพิ่มสินค้า: บันทึกข้อมูลครบและเขียน activity log', () => {
  const { db, user, office, phone } = setup();
  const item = items.createItem(
    db,
    { name: 'iPhone 15', quantity: 3, unit: 'เครื่อง', note: 'ของสำนักงาน', categoryId: phone, officeId: office },
    user.id
  );

  assert.equal(item.name, 'iPhone 15');
  assert.equal(item.quantity, 3);
  assert.equal(item.office_name, 'SH666');
  assert.equal(item.category_name, 'โทรศัพท์');
  assert.equal(item.updated_by_name, 'boss');

  const log = logs.listLogs(db).rows[0];
  assert.equal(log.action, 'create');
  assert.equal(log.item_name, 'iPhone 15');
  assert.equal(log.username, 'boss');
  db.close();
});

test('เพิ่มสินค้า: ตรวจความถูกต้องของข้อมูล', () => {
  const { db, user, office, phone } = setup();
  const base = { name: 'ของทดสอบ', quantity: 1, categoryId: phone, officeId: office };

  assert.throws(() => items.createItem(db, { ...base, name: '   ' }, user.id), /กรุณากรอกชื่อสินค้า/);
  assert.throws(() => items.createItem(db, { ...base, quantity: -1 }, user.id), /จำนวนต้องเป็นจำนวนเต็ม/);
  assert.throws(() => items.createItem(db, { ...base, quantity: 1.5 }, user.id), /จำนวนต้องเป็นจำนวนเต็ม/);
  assert.throws(() => items.createItem(db, { ...base, quantity: NaN }, user.id), /จำนวนต้องเป็นจำนวนเต็ม/);
  assert.throws(() => items.createItem(db, { ...base, categoryId: 9999 }, user.id), /หมวดหมู่/);
  assert.throws(() => items.createItem(db, { ...base, officeId: 9999 }, user.id), /สำนักงาน/);
  assert.equal(items.listItems(db).total, 0, 'ข้อมูลไม่ถูกต้องต้องไม่ถูกบันทึก');
  db.close();
});

test('แก้ไขสินค้า: อัปเดตค่าและบันทึกว่าเปลี่ยนอะไรบ้าง', () => {
  const { db, user, office, office2, phone, computer } = setup();
  const item = items.createItem(
    db,
    { name: 'Notebook Dell', quantity: 2, unit: 'เครื่อง', categoryId: computer, officeId: office },
    user.id
  );

  const updated = items.updateItem(
    db,
    item.id,
    { name: 'Notebook Dell 5420', quantity: 0, unit: 'เครื่อง', note: 'ส่งซ่อม', categoryId: phone, officeId: office2 },
    user.id
  );

  assert.equal(updated.name, 'Notebook Dell 5420');
  assert.equal(updated.quantity, 0);
  assert.equal(updated.office_name, 'UB89');
  assert.equal(updated.category_name, 'โทรศัพท์');

  const log = logs.listLogs(db).rows[0];
  assert.equal(log.action, 'update');
  assert.match(log.detail, /จำนวน: 2 → 0/);
  assert.match(log.detail, /สำนักงาน: SH666 → UB89/);

  assert.throws(() => items.updateItem(db, 9999, { name: 'x', quantity: 1, categoryId: phone, officeId: office }, user.id), /ไม่พบสินค้า/);
  db.close();
});

test('ลบสินค้า: ลบออกจริงและบันทึก log', () => {
  const { db, user, office, phone } = setup();
  const item = items.createItem(db, { name: 'สายชาร์จ', quantity: 10, categoryId: phone, officeId: office }, user.id);

  const removed = items.deleteItem(db, item.id, user.id);
  assert.equal(removed.name, 'สายชาร์จ');
  assert.equal(items.getItem(db, item.id), undefined);
  assert.equal(items.listItems(db).total, 0);

  const log = logs.listLogs(db).rows[0];
  assert.equal(log.action, 'delete');
  assert.equal(log.item_name, 'สายชาร์จ');

  assert.throws(() => items.deleteItem(db, item.id, user.id), /ไม่พบสินค้า/);
  db.close();
});

test('ค้นหาและกรอง: ตามชื่อ สำนักงาน หมวดหมู่ และเฉพาะที่หมด', () => {
  const { db, user, office, office2, phone, computer } = setup();
  items.createItem(db, { name: 'iPhone 15', quantity: 3, categoryId: phone, officeId: office }, user.id);
  items.createItem(db, { name: 'iPhone 14', quantity: 0, categoryId: phone, officeId: office2 }, user.id);
  items.createItem(db, { name: 'Macbook Air', quantity: 5, categoryId: computer, officeId: office }, user.id);

  assert.equal(items.listItems(db, { q: 'iphone' }).total, 2, 'ค้นหาต้องไม่สนตัวพิมพ์เล็กใหญ่');
  assert.equal(items.listItems(db, { q: 'iPhone 15' }).total, 1);
  assert.equal(items.listItems(db, { officeId: office }).total, 2);
  assert.equal(items.listItems(db, { categoryId: phone }).total, 2);
  assert.equal(items.listItems(db, { officeId: office, categoryId: phone }).total, 1);
  assert.equal(items.listItems(db, { onlyEmpty: true }).rows[0].name, 'iPhone 14');
  assert.equal(items.listItems(db, { q: '%' }).total, 0, 'อักขระ wildcard ต้องถูก escape');
  db.close();
});

test('แถบสรุป: นับจำนวนรวมและสินค้าที่หมดตาม filter ปัจจุบัน', () => {
  const { db, user, office, office2, phone } = setup();
  items.createItem(db, { name: 'ก', quantity: 4, categoryId: phone, officeId: office }, user.id);
  items.createItem(db, { name: 'ข', quantity: 0, categoryId: phone, officeId: office }, user.id);
  items.createItem(db, { name: 'ค', quantity: 6, categoryId: phone, officeId: office2 }, user.id);

  const all = items.listItems(db);
  assert.equal(all.total, 3);
  assert.equal(all.totalQuantity, 10);
  assert.equal(all.outOfStock, 1);

  const filtered = items.listItems(db, { officeId: office });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.totalQuantity, 4);
  assert.equal(filtered.outOfStock, 1);
  db.close();
});

test('แบ่งหน้า: สินค้า 1,200 รายการ แบ่งหน้าละ 50 ได้ถูกต้อง', () => {
  const { db, user, office, phone } = setup();
  const insert = db.transaction(() => {
    for (let i = 1; i <= 1200; i += 1) {
      items.createItem(
        db,
        { name: `สินค้า ${String(i).padStart(4, '0')}`, quantity: i % 5, categoryId: phone, officeId: office },
        user.id
      );
    }
  });
  insert();

  const first = items.listItems(db, { page: 1, perPage: 50 });
  assert.equal(first.total, 1200);
  assert.equal(first.pages, 24);
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0].name, 'สินค้า 0001');

  const last = items.listItems(db, { page: 24, perPage: 50 });
  assert.equal(last.rows.length, 50);
  assert.equal(last.rows.at(-1).name, 'สินค้า 1200');

  // หน้าที่เกินขอบเขตต้องถูกดึงกลับมาอยู่ในช่วงที่ถูกต้อง
  assert.equal(items.listItems(db, { page: 999, perPage: 50 }).page, 24);
  assert.equal(items.listItems(db, { page: 0, perPage: 50 }).page, 1);
  assert.equal(items.listItems(db, { page: 'abc', perPage: 50 }).page, 1);

  // listAllItems (ใช้ตอน export) ต้องได้ครบทุกรายการตาม filter
  assert.equal(items.listAllItems(db).length, 1200);
  assert.equal(items.listAllItems(db, { q: 'สินค้า 012' }).length, 10, 'ต้องได้ สินค้า 0120-0129');
  db.close();
});

test('ประวัติการใช้งาน: เรียงใหม่สุดขึ้นก่อนและแบ่งหน้าได้', () => {
  const { db, user, office, phone } = setup();
  for (let i = 1; i <= 60; i += 1) {
    items.createItem(db, { name: `ของ ${i}`, quantity: 1, categoryId: phone, officeId: office }, user.id);
  }
  const page1 = logs.listLogs(db, { page: 1, perPage: 50 });
  assert.equal(page1.total, 60);
  assert.equal(page1.pages, 2);
  assert.equal(page1.rows.length, 50);
  assert.equal(page1.rows[0].item_name, 'ของ 60');
  assert.equal(logs.listLogs(db, { page: 2, perPage: 50 }).rows.length, 10);
  db.close();
});
