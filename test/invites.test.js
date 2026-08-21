'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser, makeInvite } = require('./helpers');
const invites = require('../src/services/invites');
const users = require('../src/services/users');

test('สร้างรหัสเชิญหลายรหัสพร้อมกัน: ได้ครบตามจำนวนและไม่ซ้ำกัน', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');

  const created = invites.createCodes(db, { count: 15, createdBy: admin.id });
  assert.equal(created.length, 15);
  assert.equal(new Set(created.map((c) => c.code)).size, 15, 'รหัสต้องไม่ซ้ำกัน');
  assert.equal(invites.countActive(db), 15);

  for (const invite of created) {
    assert.equal(invite.created_by, admin.id);
    assert.equal(invite.used_by, null);
    assert.equal(invite.used_at, null);
    assert.ok(invite.expires_at > invite.created_at);
  }
  db.close();
});

test('รูปแบบรหัส: 8 ตัวอักษร base32 ที่ไม่มีตัวที่สับสน (0, O, 1, I, L)', () => {
  const db = freshDb();
  const created = invites.createCodes(db, { count: 50 });
  for (const invite of created) {
    assert.equal(invite.code.length, 8);
    assert.match(invite.code, /^[A-HJ-KM-NP-Z2-9]{8}$/);
    assert.doesNotMatch(invite.code, /[01OIL]/, 'ต้องไม่มีตัวอักษรที่สับสนกับตัวเลข');
  }
  db.close();
});

test('สร้างรหัสเชิญ: จำนวนต้องถูกต้องและไม่เกินครั้งละ 100', () => {
  const db = freshDb();
  assert.throws(() => invites.createCodes(db, { count: 0 }), /ตั้งแต่ 1 ขึ้นไป/);
  assert.throws(() => invites.createCodes(db, { count: -3 }), /ตั้งแต่ 1 ขึ้นไป/);
  assert.throws(() => invites.createCodes(db, { count: 2.5 }), /จำนวนเต็ม/);
  assert.throws(() => invites.createCodes(db, { count: 'มาก' }), /จำนวนเต็ม/);
  assert.throws(() => invites.createCodes(db, { count: 101 }), /ไม่เกิน 100/);
  assert.equal(invites.listCodes(db).length, 0, 'ต้องไม่สร้างอะไรเลยเมื่อจำนวนไม่ถูกต้อง');
  db.close();
});

test('หมดอายุ 24 ชั่วโมงหลังสร้าง', () => {
  const db = freshDb();
  const invite = makeInvite(db);
  const created = new Date(invite.created_at.replace(' ', 'T') + 'Z');
  const expires = new Date(invite.expires_at.replace(' ', 'T') + 'Z');
  assert.equal(expires - created, 24 * 60 * 60 * 1000);
  db.close();
});

test('สมัครด้วยรหัสถูกต้อง: ผ่าน และรหัสถูกทำเครื่องหมายว่าใช้แล้ว', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');
  const invite = makeInvite(db, admin.id);

  const user = users.register(db, { username: 'staff', password: 'password123', inviteCode: invite.code });
  assert.equal(user.username, 'staff');
  assert.equal(user.role, 'user');

  const after = invites.listCodes(db).find((c) => c.code === invite.code);
  assert.equal(after.status, 'used');
  assert.equal(after.used_by, user.id);
  assert.equal(after.used_by_name, 'staff');
  assert.ok(after.used_at, 'ต้องบันทึกเวลาที่ใช้');
  assert.equal(invites.countActive(db), 0);
  db.close();
});

test('รหัสเชิญพิมพ์ตัวเล็ก/มีช่องว่างหรือขีดคั่น ก็ยังใช้ได้', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  const invite = makeInvite(db);

  const messy = ' ' + invite.code.toLowerCase().slice(0, 4) + '-' + invite.code.toLowerCase().slice(4) + ' ';
  const user = users.register(db, { username: 'staff', password: 'password123', inviteCode: messy });
  assert.equal(user.username, 'staff');
  db.close();
});

test('สมัครด้วยรหัสที่ใช้ไปแล้ว: ต้องถูกปฏิเสธ', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  const invite = makeInvite(db);

  users.register(db, { username: 'staff', password: 'password123', inviteCode: invite.code });
  assert.throws(
    () => users.register(db, { username: 'staff2', password: 'password123', inviteCode: invite.code }),
    /ถูกใช้ไปแล้ว/
  );
  assert.equal(users.countUsers(db), 2, 'ต้องไม่มีผู้ใช้เพิ่ม');
  db.close();
});

test('สมัครด้วยรหัสหมดอายุ: ต้องถูกปฏิเสธ', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  const invite = makeInvite(db);

  // ย้อนเวลาหมดอายุให้เป็นเมื่อชั่วโมงที่แล้ว
  db.prepare("UPDATE invite_codes SET expires_at = datetime('now', '-1 hours') WHERE id = ?").run(invite.id);

  assert.throws(
    () => users.register(db, { username: 'staff', password: 'password123', inviteCode: invite.code }),
    /หมดอายุแล้ว/
  );
  assert.equal(users.countUsers(db), 1);
  assert.equal(invites.listCodes(db)[0].status, 'expired');
  assert.equal(invites.countActive(db), 0);
  db.close();
});

test('สมัครด้วยรหัสที่ไม่มีอยู่จริง: ต้องถูกปฏิเสธ', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  makeInvite(db);

  assert.throws(
    () => users.register(db, { username: 'staff', password: 'password123', inviteCode: 'ZZZZZZZZ' }),
    /รหัสเชิญไม่ถูกต้อง/
  );
  assert.throws(
    () => users.register(db, { username: 'staff', password: 'password123', inviteCode: '' }),
    /กรุณากรอกรหัสเชิญ/
  );
  assert.equal(users.countUsers(db), 1);
  assert.equal(invites.countActive(db), 1, 'รหัสที่มีอยู่ต้องไม่ถูกใช้ไป');
  db.close();
});

test('สมัครไม่สำเร็จเพราะข้อมูลอื่นผิด: รหัสเชิญต้องยังไม่ถูกใช้', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  const invite = makeInvite(db);

  assert.throws(
    () => users.register(db, { username: 'ab', password: 'password123', inviteCode: invite.code }),
    /อย่างน้อย 3/
  );
  assert.throws(
    () => users.register(db, { username: 'staff', password: '123', inviteCode: invite.code }),
    /อย่างน้อย 6/
  );
  assert.equal(invites.countActive(db), 1, 'รหัสต้องยังใช้ได้อยู่');

  const user = users.register(db, { username: 'staff', password: 'password123', inviteCode: invite.code });
  assert.equal(user.username, 'staff');
  db.close();
});

test('รายการรหัสเชิญ: เรียงรหัสที่ยังใช้ได้ไว้บนสุด แล้วตามด้วยที่ใช้แล้วและหมดอายุ', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');

  const expired = makeInvite(db, admin.id);
  db.prepare("UPDATE invite_codes SET expires_at = datetime('now', '-1 hours') WHERE id = ?").run(expired.id);

  const used = makeInvite(db, admin.id);
  users.register(db, { username: 'staff', password: 'password123', inviteCode: used.code });

  const active = makeInvite(db, admin.id);

  const rows = invites.listCodes(db);
  assert.deepEqual(
    rows.map((r) => r.status),
    ['active', 'used', 'expired']
  );
  assert.equal(rows[0].code, active.code);
  assert.equal(rows[0].created_by_name, 'boss');
  db.close();
});

test('ลบผู้ใช้ที่เคยใช้รหัสเชิญ: รหัสยังคงสถานะ "ใช้แล้ว" (ใช้ซ้ำไม่ได้)', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');
  const invite = makeInvite(db, admin.id);
  const staff = users.register(db, { username: 'staff', password: 'password123', inviteCode: invite.code });

  users.deleteUser(db, staff.id, admin.id);

  const row = invites.listCodes(db).find((c) => c.code === invite.code);
  assert.equal(row.status, 'used');
  assert.equal(row.used_by, null, 'FK ถูกตั้งเป็น NULL เมื่อผู้ใช้ถูกลบ');
  assert.ok(row.used_at, 'แต่ยังมีเวลาที่ใช้บันทึกไว้');
  assert.throws(
    () => users.register(db, { username: 'staff2', password: 'password123', inviteCode: invite.code }),
    /ถูกใช้ไปแล้ว/
  );
  db.close();
});

test('การกระจายตัวของรหัสสุ่ม: ตัวอักษรต้องมาจากชุดที่กำหนดและไม่ซ้ำกันเมื่อสุ่มจำนวนมาก', () => {
  const codes = new Set();
  for (let i = 0; i < 500; i += 1) codes.add(invites.generateCode());
  assert.equal(codes.size, 500, 'สุ่ม 500 ครั้งไม่ควรได้รหัสซ้ำ');
  for (const code of codes) assert.ok([...code].every((ch) => invites.ALPHABET.includes(ch)));
});
