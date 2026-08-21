'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, makeUser } = require('./helpers');
const users = require('../src/services/users');

test('สมัครสมาชิก: ผู้ใช้คนแรกสมัครได้โดยไม่ต้องใช้รหัสเชิญ (ยังไม่มีใครสร้างรหัสให้ได้)', () => {
  const db = freshDb();
  const first = users.register(db, { username: 'boss', password: 'password123', inviteCode: '' });
  assert.equal(first.role, 'admin');
  db.close();
});

test('สมัครสมาชิก: คนที่สองต้องมีรหัสเชิญที่ใช้ได้', () => {
  const db = freshDb();
  makeUser(db, 'boss');
  assert.throws(
    () => users.register(db, { username: 'staff', password: 'password123', inviteCode: 'NOTREAL1' }),
    /รหัสเชิญไม่ถูกต้อง/
  );
  assert.throws(
    () => users.register(db, { username: 'staff', password: 'password123', inviteCode: '' }),
    /กรุณากรอกรหัสเชิญ/
  );
  assert.equal(users.countUsers(db), 1, 'ต้องไม่ถูกสร้างขึ้นเมื่อรหัสเชิญใช้ไม่ได้');
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
