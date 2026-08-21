'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser, TEST_CONFIG } = require('./helpers');
const users = require('../src/services/users');

test('สมัครสมาชิก: ต้องกรอกรหัสเชิญให้ถูกต้อง', () => {
  const db = freshDb();
  assert.throws(
    () =>
      users.register(db, {
        username: 'somchai',
        password: 'password123',
        inviteCode: 'ผิด',
        expectedInviteCode: TEST_CONFIG.inviteCode,
      }),
    /รหัสเชิญไม่ถูกต้อง/
  );
  assert.equal(users.countUsers(db), 0, 'ต้องไม่ถูกสร้างขึ้นเมื่อรหัสเชิญผิด');
  db.close();
});

test('สมัครสมาชิก: ระบบที่ยังไม่ตั้ง INVITE_CODE ต้องสมัครไม่ได้', () => {
  const db = freshDb();
  assert.throws(
    () => users.register(db, { username: 'somchai', password: 'password123', inviteCode: '', expectedInviteCode: '' }),
    /INVITE_CODE/
  );
  db.close();
});

test('สมัครสมาชิก: คนแรกได้ admin คนถัดไปเป็น user', () => {
  const db = freshDb();
  const first = makeUser(db, 'boss');
  const second = makeUser(db, 'staff');
  assert.equal(first.role, 'admin');
  assert.equal(second.role, 'user');
  db.close();
});

test('สมัครสมาชิก: ชื่อผู้ใช้ซ้ำไม่ได้ และรหัสผ่านต้องถูกเก็บเป็น scrypt hash', () => {
  const db = freshDb();
  const user = makeUser(db, 'somchai', 'password123');
  assert.ok(user.password_hash.startsWith('scrypt$'));
  assert.ok(!user.password_hash.includes('password123'), 'ห้ามเก็บรหัสผ่านแบบ plain text');
  assert.throws(() => makeUser(db, 'somchai'), /มีชื่อผู้ใช้นี้ในระบบแล้ว/);
  db.close();
});

test('authenticate: คืน user เมื่อรหัสถูก และคืน null เมื่อผิด', () => {
  const db = freshDb();
  makeUser(db, 'somchai', 'password123');
  assert.equal(users.authenticate(db, 'somchai', 'password123').username, 'somchai');
  assert.equal(users.authenticate(db, 'somchai', 'password124'), null);
  assert.equal(users.authenticate(db, 'ไม่มีคนนี้', 'password123'), null);
  db.close();
});

test('reset password: ตั้งรหัสใหม่แล้วรหัสเก่าต้องใช้ไม่ได้', () => {
  const db = freshDb();
  const user = makeUser(db, 'staff', 'password123');
  users.resetPassword(db, user.id, 'newpassword456');
  assert.equal(users.authenticate(db, 'staff', 'password123'), null);
  assert.ok(users.authenticate(db, 'staff', 'newpassword456'));
  assert.throws(() => users.resetPassword(db, user.id, '123'), /อย่างน้อย 6/);
  db.close();
});

test('เปลี่ยน role: ทำได้ แต่ห้ามเหลือ admin น้อยกว่า 1 คน และห้ามลดสิทธิ์ตัวเอง', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');
  const staff = makeUser(db, 'staff');

  assert.equal(users.changeRole(db, staff.id, 'admin', admin.id).role, 'admin');
  assert.equal(users.changeRole(db, staff.id, 'user', admin.id).role, 'user');
  assert.throws(() => users.changeRole(db, admin.id, 'user', admin.id), /ตัวเอง/);
  assert.throws(() => users.changeRole(db, staff.id, 'superuser', admin.id), /สิทธิ์ไม่ถูกต้อง/);

  // ถ้ามี admin คนเดียวแล้วให้ admin อีกคนมาลดสิทธิ์ ก็ต้องไม่ได้
  const other = makeUser(db, 'other');
  users.changeRole(db, other.id, 'admin', admin.id);
  users.deleteUser(db, admin.id, other.id);
  assert.throws(() => users.changeRole(db, other.id, 'user', staff.id), /อย่างน้อย 1 คน/);
  db.close();
});

test('ลบผู้ใช้: ลบตัวเองไม่ได้ และลบ admin คนสุดท้ายไม่ได้', () => {
  const db = freshDb();
  const admin = makeUser(db, 'boss');
  const staff = makeUser(db, 'staff');

  assert.throws(() => users.deleteUser(db, admin.id, admin.id), /ตัวเอง/);
  assert.throws(() => users.deleteUser(db, admin.id, staff.id), /อย่างน้อย 1 คน/);

  users.deleteUser(db, staff.id, admin.id);
  assert.equal(users.listUsers(db).length, 1);
  assert.throws(() => users.deleteUser(db, 999, admin.id), /ไม่พบผู้ใช้/);
  db.close();
});
