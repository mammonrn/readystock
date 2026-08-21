'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser, startServer } = require('./helpers');
const taxonomy = require('../src/services/taxonomy');
const items = require('../src/services/items');

function names(db) {
  return taxonomy.list(db, 'categories').map((c) => c.name);
}

test('ลำดับตั้งต้น: หมวดหมู่ตั้งต้นเรียงตามที่ seed ไว้', () => {
  const db = freshDb();
  assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ']);
  assert.deepEqual(
    taxonomy.list(db, 'categories').map((c) => c.sort_order),
    [1, 2, 3]
  );
  db.close();
});

test('หมวดหมู่ใหม่ต่อท้ายลำดับล่าสุดอัตโนมัติ', () => {
  const db = freshDb();
  const created = taxonomy.create(db, 'categories', 'เครื่องเขียน');
  assert.equal(created.sort_order, 4);
  assert.equal(names(db).at(-1), 'เครื่องเขียน');

  taxonomy.create(db, 'categories', 'เฟอร์นิเจอร์');
  assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ', 'เครื่องเขียน', 'เฟอร์นิเจอร์']);
  db.close();
});

test('เรียงลำดับใหม่ทั้งชุด (ใช้ตอนลากสลับตำแหน่ง)', () => {
  const db = freshDb();
  const ids = taxonomy.list(db, 'categories').map((c) => c.id);

  taxonomy.reorderCategories(db, [ids[2], ids[0], ids[1]]);
  assert.deepEqual(names(db), ['อื่นๆ', 'โทรศัพท์', 'คอมพิวเตอร์']);
  assert.deepEqual(
    taxonomy.list(db, 'categories').map((c) => c.sort_order),
    [1, 2, 3]
  );

  // รับค่าที่ส่งมาเป็นสตริงคั่นด้วยจุลภาคได้ด้วย (ฟอร์มส่งมาแบบนี้)
  taxonomy.reorderCategories(db, `${ids[1]},${ids[2]},${ids[0]}`);
  assert.deepEqual(names(db), ['คอมพิวเตอร์', 'อื่นๆ', 'โทรศัพท์']);
  db.close();
});

test('เรียงลำดับใหม่: ต้องส่ง id มาครบทุกหมวดหมู่ ไม่งั้นปฏิเสธและลำดับเดิมไม่เปลี่ยน', () => {
  const db = freshDb();
  const ids = taxonomy.list(db, 'categories').map((c) => c.id);

  assert.throws(() => taxonomy.reorderCategories(db, [ids[0], ids[1]]), /ลำดับหมวดหมู่ไม่ถูกต้อง/);
  assert.throws(() => taxonomy.reorderCategories(db, [...ids, 9999]), /ลำดับหมวดหมู่ไม่ถูกต้อง/);
  assert.throws(() => taxonomy.reorderCategories(db, [ids[0], ids[0], ids[1]]), /ลำดับหมวดหมู่ไม่ถูกต้อง/);
  assert.throws(() => taxonomy.reorderCategories(db, ''), /ลำดับหมวดหมู่ไม่ถูกต้อง/);
  assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ'], 'ลำดับเดิมต้องไม่ถูกแตะ');
  db.close();
});

test('ปุ่มเลื่อนขึ้น/ลงทีละอันดับ', () => {
  const db = freshDb();
  const ids = taxonomy.list(db, 'categories').map((c) => c.id);

  taxonomy.moveCategory(db, ids[2], 'up');
  assert.deepEqual(names(db), ['โทรศัพท์', 'อื่นๆ', 'คอมพิวเตอร์']);

  taxonomy.moveCategory(db, ids[2], 'up');
  assert.deepEqual(names(db), ['อื่นๆ', 'โทรศัพท์', 'คอมพิวเตอร์']);

  taxonomy.moveCategory(db, ids[0], 'down');
  assert.deepEqual(names(db), ['อื่นๆ', 'คอมพิวเตอร์', 'โทรศัพท์']);
  db.close();
});

test('ปุ่มเลื่อน: อยู่บนสุด/ล่างสุดแล้วต้องไม่เปลี่ยนอะไร และทิศทางผิดต้องถูกปฏิเสธ', () => {
  const db = freshDb();
  const ids = taxonomy.list(db, 'categories').map((c) => c.id);

  taxonomy.moveCategory(db, ids[0], 'up');
  assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ']);
  taxonomy.moveCategory(db, ids[2], 'down');
  assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ']);

  assert.throws(() => taxonomy.moveCategory(db, ids[0], 'left'), /ทิศทางการเลื่อนไม่ถูกต้อง/);
  assert.throws(() => taxonomy.moveCategory(db, 9999, 'up'), /ไม่พบหมวดหมู่/);
  db.close();
});

test('ลบหมวดหมู่แล้วจัดลำดับใหม่ได้ตามปกติ', () => {
  const db = freshDb();
  const extra = taxonomy.create(db, 'categories', 'เครื่องเขียน');
  taxonomy.remove(db, 'categories', extra.id);

  const ids = taxonomy.list(db, 'categories').map((c) => c.id);
  taxonomy.reorderCategories(db, [ids[1], ids[0], ids[2]]);
  assert.deepEqual(names(db), ['คอมพิวเตอร์', 'โทรศัพท์', 'อื่นๆ']);
  db.close();
});

test('สำนักงานยังเรียงตามชื่อเหมือนเดิม (ไม่มี sort_order)', () => {
  const db = freshDb();
  assert.deepEqual(
    taxonomy.list(db, 'offices').map((o) => o.name),
    ['88F', 'SH666', 'SH999', 'UB89']
  );
  db.close();
});

test('ดรอปดาวน์เลือกหมวดหมู่ทุกหน้าต้องเรียงตาม sort_order', async () => {
  const db = freshDb();
  const user = makeUser(db, 'boss');
  const client = await startServer(db);
  try {
    await client.login('boss', 'password123');

    const ids = taxonomy.list(db, 'categories').map((c) => c.id);
    taxonomy.reorderCategories(db, [ids[2], ids[0], ids[1]]); // อื่นๆ, โทรศัพท์, คอมพิวเตอร์

    const expected = ['อื่นๆ', 'โทรศัพท์', 'คอมพิวเตอร์'];
    const office = taxonomy.list(db, 'offices')[0];
    items.createItem(db, { name: 'ของ', quantity: 1, categoryId: ids[0], officeId: office.id }, user.id);

    for (const path of ['/items', '/items/new', `/items/${items.listItems(db).rows[0].id}/edit`]) {
      const html = await (await client.request(path)).text();
      const options = [...html.matchAll(/<option value="\d+"[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
      const categoryOptions = options.filter((name) => expected.includes(name));
      assert.deepEqual(categoryOptions, expected, `ลำดับในหน้า ${path} ต้องตรงกับ sort_order`);
    }
  } finally {
    await client.close();
    db.close();
  }
});

test('หน้า admin: ลากสลับลำดับ (ส่ง order) และปุ่มเลื่อนขึ้น/ลง ทำงานผ่านเว็บ', async () => {
  const db = freshDb();
  makeUser(db, 'boss');
  const client = await startServer(db);
  try {
    await client.login('boss', 'password123');
    const ids = taxonomy.list(db, 'categories').map((c) => c.id);

    const reorder = await client.post('/admin/categories/reorder', { order: `${ids[2]},${ids[1]},${ids[0]}` }, '/admin');
    assert.equal(reorder.status, 302);
    assert.deepEqual(names(db), ['อื่นๆ', 'คอมพิวเตอร์', 'โทรศัพท์']);

    await client.post(`/admin/categories/${ids[0]}/move`, { direction: 'up' }, '/admin');
    assert.deepEqual(names(db), ['อื่นๆ', 'โทรศัพท์', 'คอมพิวเตอร์']);

    const bad = await client.post('/admin/categories/reorder', { order: `${ids[0]}` }, '/admin');
    assert.equal(bad.status, 302);
    assert.match(await (await client.request('/admin')).text(), /ลำดับหมวดหมู่ไม่ถูกต้อง/);
    assert.deepEqual(names(db), ['อื่นๆ', 'โทรศัพท์', 'คอมพิวเตอร์'], 'ลำดับต้องไม่ถูกแตะเมื่อข้อมูลไม่ถูกต้อง');
  } finally {
    await client.close();
    db.close();
  }
});

test('หน้า admin: user ธรรมดาจัดลำดับหมวดหมู่ไม่ได้', async () => {
  const db = freshDb();
  makeUser(db, 'boss');
  makeUser(db, 'staff');
  const client = await startServer(db);
  try {
    await client.login('staff', 'password123');
    const ids = taxonomy.list(db, 'categories').map((c) => c.id);
    const res = await client.post('/admin/categories/reorder', { order: `${ids[2]},${ids[1]},${ids[0]}` }, '/items');
    assert.equal(res.status, 403);
    assert.deepEqual(names(db), ['โทรศัพท์', 'คอมพิวเตอร์', 'อื่นๆ']);
  } finally {
    await client.close();
    db.close();
  }
});
