'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { freshDb, makeUser, makeInvite, startServer } = require('./helpers');
const invites = require('../src/services/invites');
const items = require('../src/services/items');
const taxonomy = require('../src/services/taxonomy');

async function withServer(fn, configOverrides = {}) {
  const db = freshDb();
  const client = await startServer(db, configOverrides);
  try {
    await fn({ db, client });
  } finally {
    await client.close();
    db.close();
  }
}

test('GET /healthz: ใช้ได้โดยไม่ต้อง login', async () => {
  await withServer(async ({ client }) => {
    const res = await client.request('/healthz');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.uptime === 'number');
  });
});

test('ยังไม่ได้ login: เข้าหน้าอื่นต้องถูกส่งไปหน้า login', async () => {
  await withServer(async ({ client }) => {
    for (const path of ['/', '/items', '/logs', '/admin']) {
      const res = await client.request(path);
      assert.equal(res.status, 302, `${path} ต้อง redirect`);
      assert.match(res.headers.get('location'), /^\/(login|items)/);
    }
  });
});

test('สมัครสมาชิกผ่านเว็บ: คนแรกสมัครได้เลยและได้สิทธิ์ admin', async () => {
  await withServer(async ({ client, db }) => {
    const page = await (await client.request('/register')).text();
    assert.match(page, /ไม่ต้องใช้รหัสเชิญ/, 'หน้าสมัครต้องบอกว่าคนแรกไม่ต้องใช้รหัสเชิญ');

    const ok = await client.post('/register', { username: 'boss', password: 'password123' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/items');
    assert.equal(db.prepare("SELECT role FROM users WHERE username = 'boss'").get().role, 'admin');
  });
});

test('สมัครสมาชิกผ่านเว็บ: คนถัดไปต้องใช้รหัสเชิญที่ยังใช้ได้ และใช้ซ้ำไม่ได้', async () => {
  await withServer(async ({ client, db }) => {
    const admin = makeUser(db, 'boss');
    const invite = makeInvite(db, admin.id);

    const wrong = await client.post('/register', { username: 'staff', password: 'password123', inviteCode: 'ZZZZZZZZ' });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /รหัสเชิญไม่ถูกต้อง/);

    const ok = await client.post('/register', { username: 'staff', password: 'password123', inviteCode: invite.code });
    assert.equal(ok.status, 302);
    assert.equal(db.prepare("SELECT role FROM users WHERE username = 'staff'").get().role, 'user');

    await client.post('/logout', {}, '/items');
    const reuse = await client.post('/register', { username: 'staff2', password: 'password123', inviteCode: invite.code });
    assert.equal(reuse.status, 400);
    assert.match(await reuse.text(), /ถูกใช้ไปแล้ว/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  });
});

test('สมัครสมาชิกผ่านเว็บ: รหัสเชิญหมดอายุต้องขึ้นข้อความบอกว่าหมดอายุ', async () => {
  await withServer(async ({ client, db }) => {
    makeUser(db, 'boss');
    const invite = makeInvite(db);
    db.prepare("UPDATE invite_codes SET expires_at = datetime('now', '-1 hours') WHERE id = ?").run(invite.id);

    const res = await client.post('/register', { username: 'staff', password: 'password123', inviteCode: invite.code });
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /หมดอายุแล้ว/);
    assert.match(html, /24 ชั่วโมง/);
  });
});

test('cookie ต้องเป็น HttpOnly และ SameSite=Lax', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    const res = await client.login('boss', 'password123');
    const raw = (res.headers.getSetCookie() || []).find((c) => c.startsWith('readystock.sid='));
    assert.ok(raw, 'ต้องมี session cookie');
    assert.match(raw, /HttpOnly/i);
    assert.match(raw, /SameSite=Lax/i);
    assert.doesNotMatch(raw, /Secure/i, 'โหมดทดสอบ (COOKIE_SECURE=false) ต้องไม่ติด Secure');
  });
});

test('cookie ต้องมี Secure เมื่อเปิด COOKIE_SECURE (ผ่าน nginx https)', async () => {
  await withServer(
    async ({ db, client }) => {
      makeUser(db, 'boss');
      // จำลอง request ที่ผ่าน nginx reverse proxy แบบ https (app ตั้ง trust proxy ไว้แล้ว)
      const loginPage = await client.request('/login', { headers: { 'x-forwarded-proto': 'https' } });
      const csrf = (await loginPage.text()).match(/name="_csrf" value="([^"]+)"/)[1];
      const res = await client.request('/login', {
        method: 'POST',
        form: { username: 'boss', password: 'password123', _csrf: csrf },
        headers: { 'x-forwarded-proto': 'https' },
      });
      assert.equal(res.status, 302);
      const raw = (res.headers.getSetCookie() || []).find((c) => c.startsWith('readystock.sid='));
      assert.ok(raw, 'ต้องมี session cookie');
      assert.match(raw, /Secure/);
      assert.match(raw, /HttpOnly/i);
    },
    { cookieSecure: true }
  );
});

test('login ผิด 5 ครั้ง: ครั้งที่ 6 ต้องโดนล็อก (HTTP 429)', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss', 'password123');

    for (let i = 0; i < 5; i += 1) {
      const res = await client.login('boss', 'ผิดแน่นอน');
      assert.equal(res.status, 401, `ครั้งที่ ${i + 1} ต้องเป็น 401`);
    }

    const locked = await client.login('boss', 'ผิดแน่นอน');
    assert.equal(locked.status, 429);
    assert.match(await locked.text(), /กรุณารออีก 15 นาที/);

    // แม้รหัสถูกต้องก็ยังเข้าไม่ได้ระหว่างถูกล็อก
    const correct = await client.login('boss', 'password123');
    assert.equal(correct.status, 429);
  });
});

test('POST ที่ไม่มี CSRF token ต้องถูกปฏิเสธ', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const res = await client.request('/items/new', { method: 'POST', form: { name: 'ของแอบเพิ่ม', quantity: 1 } });
    assert.equal(res.status, 403);
    assert.equal(items.listItems(db).total, 0);
  });
});

test('flow เต็ม: login → เพิ่มสินค้า → เห็นในตาราง → แก้ไข → ลบ → เห็นใน log', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const office = taxonomy.list(db, 'offices').find((o) => o.name === 'SH666');
    const category = taxonomy.list(db, 'categories').find((c) => c.name === 'โทรศัพท์');

    const created = await client.post(
      '/items/new',
      { name: 'iPhone 15', quantity: '0', unit: 'เครื่อง', note: 'รอเบิก', categoryId: category.id, officeId: office.id },
      '/items/new'
    );
    assert.equal(created.status, 302);

    const list = await client.request('/items');
    const html = await list.text();
    assert.match(html, /iPhone 15/);
    assert.match(html, /หมด/, 'จำนวน 0 ต้องแสดงว่า "หมด"');
    assert.match(html, /row-empty/, 'แถวที่ของหมดต้องถูกไฮไลต์');

    const item = items.listItems(db).rows[0];
    const edited = await client.post(
      `/items/${item.id}/edit`,
      { name: 'iPhone 15 Pro', quantity: '7', unit: 'เครื่อง', note: '', categoryId: category.id, officeId: office.id },
      `/items/${item.id}/edit`
    );
    assert.equal(edited.status, 302);
    assert.equal(items.getItem(db, item.id).quantity, 7);

    const deleted = await client.post(`/items/${item.id}/delete`, {}, '/items');
    assert.equal(deleted.status, 302);
    assert.equal(items.listItems(db).total, 0);

    const logsHtml = await (await client.request('/logs')).text();
    assert.match(logsHtml, /iPhone 15 Pro/);
    assert.match(logsHtml, /เพิ่ม/);
    assert.match(logsHtml, /ลบ/);
  });
});

test('ค้นหาและกรองผ่าน query string ต้องคัดกรองแถวในตาราง', async () => {
  await withServer(async ({ db, client }) => {
    const user = makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const offices = taxonomy.list(db, 'offices');
    const category = taxonomy.list(db, 'categories')[0];
    items.createItem(db, { name: 'จอคอม 24 นิ้ว', quantity: 2, categoryId: category.id, officeId: offices[0].id }, user.id);
    items.createItem(db, { name: 'คีย์บอร์ด', quantity: 9, categoryId: category.id, officeId: offices[1].id }, user.id);

    const searched = await (await client.request('/items?q=' + encodeURIComponent('จอคอม'))).text();
    assert.match(searched, /จอคอม 24 นิ้ว/);
    assert.doesNotMatch(searched, /คีย์บอร์ด/);

    const byOffice = await (await client.request(`/items?office=${offices[1].id}`)).text();
    assert.match(byOffice, /คีย์บอร์ด/);
    assert.doesNotMatch(byOffice, /จอคอม 24 นิ้ว/);
  });
});

test('Export Excel: ได้ไฟล์ .xlsx ที่มีเฉพาะรายการตาม filter ปัจจุบัน', async () => {
  await withServer(async ({ db, client }) => {
    const user = makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const offices = taxonomy.list(db, 'offices');
    const category = taxonomy.list(db, 'categories')[0];
    items.createItem(db, { name: 'เมาส์', quantity: 4, unit: 'ตัว', categoryId: category.id, officeId: offices[0].id }, user.id);
    items.createItem(db, { name: 'คีย์บอร์ด', quantity: 6, unit: 'ตัว', categoryId: category.id, officeId: offices[1].id }, user.id);

    const res = await client.request(`/items/export.xlsx?office=${offices[0].id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="readystock-\d{4}-\d{2}-\d{2}\.xlsx"/);

    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('รายการสินค้า');
    assert.ok(sheet, 'ต้องมีชีต "รายการสินค้า"');
    assert.equal(sheet.getRow(1).getCell(2).value, 'รหัสสินค้า');
    assert.equal(sheet.getRow(1).getCell(3).value, 'ชื่อสินค้า');
    assert.match(String(sheet.getRow(2).getCell(2).value), /^[A-Z]+\d{4}$/, 'ต้อง export รหัสสินค้าออกมาด้วย');
    assert.equal(sheet.getRow(2).getCell(3).value, 'เมาส์');
    assert.equal(sheet.getRow(2).getCell(6).value, 4);
    assert.equal(sheet.getRow(3).getCell(3).value, null, 'สินค้าที่อยู่นอก filter ต้องไม่ถูก export');
  });
});

test('หน้า admin: user ธรรมดาเข้าไม่ได้ (403) แต่ admin เข้าได้', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    makeUser(db, 'staff');

    await client.login('staff', 'password123');
    const denied = await client.request('/admin');
    assert.equal(denied.status, 403);
    assert.match(await denied.text(), /ผู้ดูแลระบบ/);

    const deniedPost = await client.post('/admin/offices/create', { name: 'แอบเพิ่ม' }, '/items');
    assert.equal(deniedPost.status, 403);
    assert.ok(!taxonomy.list(db, 'offices').some((o) => o.name === 'แอบเพิ่ม'));

    await client.post('/logout', {}, '/items');
    await client.login('boss', 'password123');
    const allowed = await client.request('/admin');
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /จัดการระบบ/);
  });
});

test('หน้า admin: เพิ่ม/แก้ชื่อ/ลบ สำนักงานผ่านเว็บ และห้ามลบเมื่อมีสินค้าใช้อยู่', async () => {
  await withServer(async ({ db, client }) => {
    const user = makeUser(db, 'boss');
    await client.login('boss', 'password123');

    await client.post('/admin/offices/create', { name: 'CNX01' }, '/admin');
    const office = taxonomy.list(db, 'offices').find((o) => o.name === 'CNX01');
    assert.ok(office);

    await client.post(`/admin/offices/${office.id}/rename`, { name: 'CNX02' }, '/admin');
    assert.ok(taxonomy.list(db, 'offices').some((o) => o.name === 'CNX02'));

    const category = taxonomy.list(db, 'categories')[0];
    items.createItem(db, { name: 'ของ', quantity: 1, categoryId: category.id, officeId: office.id }, user.id);

    await client.post(`/admin/offices/${office.id}/delete`, {}, '/admin');
    assert.ok(taxonomy.list(db, 'offices').some((o) => o.id === office.id), 'ต้องลบไม่สำเร็จ');
    assert.match(await (await client.request('/admin')).text(), /ยังมีสินค้าใช้อยู่ 1 รายการ/);
  });
});

test('หน้า admin: reset password / เปลี่ยน role / ลบผู้ใช้', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    const staff = makeUser(db, 'staff');
    await client.login('boss', 'password123');

    await client.post(`/admin/users/${staff.id}/reset-password`, { password: 'newpass456' }, '/admin');
    const usersService = require('../src/services/users');
    assert.ok(usersService.authenticate(db, 'staff', 'newpass456'));

    await client.post(`/admin/users/${staff.id}/role`, { role: 'admin' }, '/admin');
    assert.equal(usersService.findById(db, staff.id).role, 'admin');

    await client.post(`/admin/users/${staff.id}/delete`, {}, '/admin');
    assert.equal(usersService.findById(db, staff.id), undefined);
  });
});

test('หน้าที่ไม่มีอยู่ต้องคืน 404 พร้อมหน้าภาษาไทย', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');
    const res = await client.request('/ไม่มีหน้านี้');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /ไม่พบหน้าที่คุณเรียก/);
  });
});

test('หน้า admin: สร้างรหัสเชิญทีละหลายรหัสและแสดงในตาราง', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const res = await client.post('/admin/invites/create', { count: '15' }, '/admin');
    assert.equal(res.status, 302);

    const rows = invites.listCodes(db);
    assert.equal(rows.length, 15);
    assert.equal(rows.every((r) => r.status === 'active'), true);
    assert.equal(rows[0].created_by_name, 'boss');

    const html = await (await client.request('/admin')).text();
    assert.match(html, /สร้างรหัสเชิญใหม่ 15 รหัส/);
    for (const row of rows) {
      assert.ok(html.includes(row.code), `ตารางต้องแสดงรหัส ${row.code}`);
      assert.ok(html.includes(`data-copy="${row.code}"`), 'ต้องมีปุ่มคัดลอกของแต่ละรหัส');
    }
  });
});

test('หน้า admin: จำนวนรหัสเชิญที่ไม่ถูกต้องต้องขึ้นข้อความเตือน ไม่สร้างอะไรเลย', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    await client.post('/admin/invites/create', { count: '0' }, '/admin');
    assert.match(await (await client.request('/admin')).text(), /ตั้งแต่ 1 ขึ้นไป/);

    await client.post('/admin/invites/create', { count: '500' }, '/admin');
    assert.match(await (await client.request('/admin')).text(), /ไม่เกิน 100/);

    assert.equal(invites.listCodes(db).length, 0);
  });
});

test('หน้า admin: ตารางรหัสเชิญแสดงสถานะใช้แล้ว/หมดอายุ ถูกต้อง', async () => {
  await withServer(async ({ db, client }) => {
    const admin = makeUser(db, 'boss');
    const used = makeInvite(db, admin.id);
    const expired = makeInvite(db, admin.id);
    db.prepare("UPDATE invite_codes SET expires_at = datetime('now', '-1 hours') WHERE id = ?").run(expired.id);

    await client.post('/register', { username: 'staff', password: 'password123', inviteCode: used.code });
    await client.post('/logout', {}, '/items');

    await client.login('boss', 'password123');
    const html = await (await client.request('/admin')).text();
    assert.match(html, /ใช้แล้ว/);
    assert.match(html, /หมดอายุแล้ว/);
    assert.match(html, /โดย staff/);
  });
});

test('user ธรรมดาสร้างรหัสเชิญไม่ได้', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    makeUser(db, 'staff');
    await client.login('staff', 'password123');

    const res = await client.post('/admin/invites/create', { count: '5' }, '/items');
    assert.equal(res.status, 403);
    assert.equal(invites.countActive(db), 0);
  });
});

test('ตารางรายการสินค้า: แสดงรหัสสินค้าเป็นคอลัมน์แรก และค้นหาด้วยรหัสได้จากช่องค้นหาเดิม', async () => {
  await withServer(async ({ db, client }) => {
    const user = makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const office = taxonomy.list(db, 'offices')[0];
    const phone = taxonomy.list(db, 'categories').find((c) => c.name === 'โทรศัพท์');
    const computer = taxonomy.list(db, 'categories').find((c) => c.name === 'คอมพิวเตอร์');
    items.createItem(db, { name: 'iPhone 15', quantity: 1, categoryId: phone.id, officeId: office.id }, user.id);
    items.createItem(db, { name: 'Macbook', quantity: 1, categoryId: computer.id, officeId: office.id }, user.id);

    const html = await (await client.request('/items')).text();
    assert.match(html, /<th class="col-code">รหัส<\/th>\s*<th class="col-name">ชื่อสินค้า<\/th>/);
    assert.match(html, /TLP0001/);
    assert.match(html, /COM0001/);

    const searched = await (await client.request('/items?q=tlp0001')).text();
    assert.match(searched, /iPhone 15/);
    assert.doesNotMatch(searched, /Macbook/);
  });
});

test('เพิ่มสินค้าผ่านเว็บ: ได้รหัสสินค้าอัตโนมัติและบันทึกรหัสลง activity log', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    const office = taxonomy.list(db, 'offices')[0];
    const phone = taxonomy.list(db, 'categories').find((c) => c.name === 'โทรศัพท์');

    for (const name of ['iPhone 15', 'iPhone 16']) {
      const res = await client.post(
        '/items/new',
        { name, quantity: '1', unit: 'เครื่อง', note: '', categoryId: phone.id, officeId: office.id },
        '/items/new'
      );
      assert.equal(res.status, 302);
    }

    assert.deepEqual(
      items.listItems(db).rows.map((r) => r.item_code).sort(),
      ['TLP0001', 'TLP0002']
    );
    assert.match(await (await client.request('/logs')).text(), /รหัส TLP0002/);
  });
});

test('หน้า admin: เพิ่มหมวดหมู่พร้อมระบุรหัสนำหน้าเอง และแก้รหัสนำหน้าภายหลังได้', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    await client.post('/admin/categories/create', { name: 'เครื่องเขียน', codePrefix: 'sta' }, '/admin');
    const created = taxonomy.list(db, 'categories').find((c) => c.name === 'เครื่องเขียน');
    assert.equal(created.code_prefix, 'STA');
    assert.equal(created.sort_order, 4);

    await client.post(`/admin/categories/${created.id}/rename`, { name: 'เครื่องเขียน', codePrefix: 'TLP' }, '/admin');
    assert.match(await (await client.request('/admin')).text(), /รหัสนำหน้า .{1,20}TLP.{1,20} ถูกใช้กับหมวดหมู่/);
    assert.equal(taxonomy.list(db, 'categories').find((c) => c.id === created.id).code_prefix, 'STA');

    await client.post(`/admin/categories/${created.id}/rename`, { name: 'เครื่องเขียนสำนักงาน', codePrefix: 'STN' }, '/admin');
    const renamed = taxonomy.list(db, 'categories').find((c) => c.id === created.id);
    assert.equal(renamed.name, 'เครื่องเขียนสำนักงาน');
    assert.equal(renamed.code_prefix, 'STN');
  });
});

test('หน้า admin: หมวดหมู่ที่สร้างโดยไม่ระบุรหัสนำหน้า ต้องได้รหัสอัตโนมัติที่ไม่ซ้ำ', async () => {
  await withServer(async ({ db, client }) => {
    makeUser(db, 'boss');
    await client.login('boss', 'password123');

    await client.post('/admin/categories/create', { name: 'Computer parts', codePrefix: '' }, '/admin');
    await client.post('/admin/categories/create', { name: 'Computer bags', codePrefix: '' }, '/admin');

    const prefixes = taxonomy.list(db, 'categories').map((c) => c.code_prefix);
    assert.equal(new Set(prefixes).size, prefixes.length, 'รหัสนำหน้าต้องไม่ซ้ำกัน');
    assert.ok(prefixes.includes('COM2') && prefixes.includes('COM3'));
  });
});
