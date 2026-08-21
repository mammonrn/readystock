'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser } = require('./helpers');
const taxonomy = require('../src/services/taxonomy');
const items = require('../src/services/items');

test('ข้อมูลตั้งต้น: มีสำนักงานและหมวดหมู่ตามที่กำหนด', () => {
  const db = freshDb();
  assert.deepEqual(
    taxonomy.list(db, 'offices').map((o) => o.name).sort(),
    ['88F', 'SH666', 'SH999', 'UB89']
  );
  assert.deepEqual(
    taxonomy.list(db, 'categories').map((c) => c.name).sort(),
    ['คอมพิวเตอร์', 'อื่นๆ', 'โทรศัพท์'].sort()
  );
  db.close();
});

test('เพิ่ม/แก้ชื่อ สำนักงาน: ชื่อซ้ำไม่ได้ ชื่อว่างไม่ได้', () => {
  const db = freshDb();
  const office = taxonomy.create(db, 'offices', '  BKK01  ');
  assert.equal(office.name, 'BKK01', 'ต้องตัดช่องว่างหน้า-หลังออก');

  assert.throws(() => taxonomy.create(db, 'offices', 'bkk01'), /มีสำนักงาน "bkk01" อยู่แล้ว/);
  assert.throws(() => taxonomy.create(db, 'offices', '   '), /กรุณากรอกชื่อสำนักงาน/);

  assert.equal(taxonomy.rename(db, 'offices', office.id, 'BKK02').name, 'BKK02');
  assert.throws(() => taxonomy.rename(db, 'offices', office.id, 'SH666'), /อยู่แล้ว/);
  assert.throws(() => taxonomy.rename(db, 'offices', 9999, 'อะไรก็ได้'), /ไม่พบสำนักงาน/);
  db.close();
});

test('เพิ่ม/แก้ชื่อ หมวดหมู่: ทำงานเหมือนกับสำนักงาน', () => {
  const db = freshDb();
  const category = taxonomy.create(db, 'categories', 'เครื่องเขียน');
  assert.equal(category.name, 'เครื่องเขียน');
  assert.throws(() => taxonomy.create(db, 'categories', 'เครื่องเขียน'), /มีหมวดหมู่ "เครื่องเขียน" อยู่แล้ว/);
  assert.equal(taxonomy.rename(db, 'categories', category.id, 'เครื่องเขียนสำนักงาน').name, 'เครื่องเขียนสำนักงาน');
  db.close();
});

test('ลบสำนักงานที่ยังมีสินค้าใช้อยู่ไม่ได้ และต้องบอกเหตุผลพร้อมจำนวน', () => {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const office = taxonomy.list(db, 'offices').find((o) => o.name === 'SH666');
  const category = taxonomy.list(db, 'categories')[0];

  items.createItem(db, { name: 'ของ 1', quantity: 1, categoryId: category.id, officeId: office.id }, user.id);
  items.createItem(db, { name: 'ของ 2', quantity: 2, categoryId: category.id, officeId: office.id }, user.id);

  assert.throws(() => taxonomy.remove(db, 'offices', office.id), (err) => {
    assert.match(err.message, /ลบสำนักงาน "SH666" ไม่ได้/);
    assert.match(err.message, /ยังมีสินค้าใช้อยู่ 2 รายการ/);
    return true;
  });
  assert.ok(taxonomy.list(db, 'offices').some((o) => o.id === office.id), 'สำนักงานต้องยังอยู่');
  db.close();
});

test('ลบหมวดหมู่ที่ยังมีสินค้าใช้อยู่ไม่ได้', () => {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const office = taxonomy.list(db, 'offices')[0];
  const category = taxonomy.list(db, 'categories').find((c) => c.name === 'คอมพิวเตอร์');

  items.createItem(db, { name: 'Macbook', quantity: 1, categoryId: category.id, officeId: office.id }, user.id);
  assert.throws(() => taxonomy.remove(db, 'categories', category.id), /ลบหมวดหมู่ "คอมพิวเตอร์" ไม่ได้ เพราะยังมีสินค้าใช้อยู่ 1 รายการ/);
  db.close();
});

test('ลบได้เมื่อไม่มีสินค้าใช้อยู่แล้ว', () => {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const office = taxonomy.list(db, 'offices').find((o) => o.name === 'UB89');
  const category = taxonomy.list(db, 'categories')[0];

  const item = items.createItem(db, { name: 'ของ', quantity: 1, categoryId: category.id, officeId: office.id }, user.id);
  assert.throws(() => taxonomy.remove(db, 'offices', office.id), /ยังมีสินค้าใช้อยู่/);

  items.deleteItem(db, item.id, user.id);
  assert.equal(taxonomy.remove(db, 'offices', office.id).name, 'UB89');
  assert.ok(!taxonomy.list(db, 'offices').some((o) => o.name === 'UB89'));
  assert.throws(() => taxonomy.remove(db, 'offices', office.id), /ไม่พบสำนักงาน/);
  db.close();
});

test('จำนวนสินค้าที่ผูกอยู่ (item_count) ต้องถูกต้อง', () => {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const office = taxonomy.list(db, 'offices').find((o) => o.name === 'SH999');
  const category = taxonomy.list(db, 'categories')[0];
  items.createItem(db, { name: 'ของ', quantity: 1, categoryId: category.id, officeId: office.id }, user.id);

  const row = taxonomy.list(db, 'offices').find((o) => o.id === office.id);
  assert.equal(row.item_count, 1);
  assert.equal(taxonomy.list(db, 'offices').find((o) => o.name === '88F').item_count, 0);
  db.close();
});
