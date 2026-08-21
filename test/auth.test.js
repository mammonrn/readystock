'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hashPassword, verifyPassword, validateCredentials, createLoginLimiter } = require('../src/auth');

test('scrypt: hash แล้ว verify กลับได้', () => {
  const hash = hashPassword('SuperSecret123');
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(verifyPassword('SuperSecret123', hash), true);
});

test('scrypt: รหัสผ่านผิดต้อง verify ไม่ผ่าน', () => {
  const hash = hashPassword('SuperSecret123');
  assert.equal(verifyPassword('supersecret123', hash), false);
  assert.equal(verifyPassword('', hash), false);
  assert.equal(verifyPassword('SuperSecret1234', hash), false);
});

test('scrypt: รหัสผ่านเดียวกันต้องได้ hash ต่างกัน (salt สุ่มทุกครั้ง)', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('same-password', a), true);
  assert.equal(verifyPassword('same-password', b), true);
});

test('scrypt: hash ที่ถูกแก้ไข/รูปแบบผิด ต้องไม่ผ่าน และต้องไม่ throw', () => {
  const hash = hashPassword('SuperSecret123');
  const parts = hash.split('$');
  const tampered = [...parts.slice(0, 5), Buffer.from('x'.repeat(64)).toString('base64')].join('$');

  assert.equal(verifyPassword('SuperSecret123', tampered), false);
  assert.equal(verifyPassword('SuperSecret123', 'bcrypt$xxx'), false);
  assert.equal(verifyPassword('SuperSecret123', 'ไม่ใช่แฮช'), false);
  assert.equal(verifyPassword('SuperSecret123', ''), false);
  assert.equal(verifyPassword('SuperSecret123', null), false);
  assert.equal(verifyPassword('SuperSecret123', 'scrypt$16384$8$1$$'), false);
});

test('scrypt: hashPassword ต้องปฏิเสธค่าว่าง', () => {
  assert.throws(() => hashPassword(''), /ต้องระบุรหัสผ่าน/);
  assert.throws(() => hashPassword(undefined), /ต้องระบุรหัสผ่าน/);
});

test('validateCredentials: ตรวจรูปแบบ username/password', () => {
  assert.equal(validateCredentials('somchai', 'password123'), null);
  assert.match(validateCredentials('ab', 'password123'), /อย่างน้อย 3/);
  assert.match(validateCredentials('a'.repeat(33), 'password123'), /ไม่เกิน 32/);
  assert.match(validateCredentials('สมชาย', 'password123'), /a-z/);
  assert.match(validateCredentials('somchai', '12345'), /อย่างน้อย 6/);
  assert.match(validateCredentials('somchai', 'x'.repeat(201)), /ยาวเกินไป/);
});

test('rate limit: ผิด 5 ครั้ง ต้องล็อก IP นั้น', () => {
  const limiter = createLoginLimiter({ maxAttempts: 5, lockMinutes: 15 });
  const ip = '203.0.113.9';

  for (let i = 1; i <= 4; i += 1) {
    const state = limiter.fail(ip);
    assert.equal(state.attempts, i);
    assert.equal(limiter.check(ip).locked, false, `ครั้งที่ ${i} ยังไม่ควรถูกล็อก`);
  }

  limiter.fail(ip);
  const locked = limiter.check(ip);
  assert.equal(locked.locked, true);
  assert.equal(locked.retryAfterMinutes, 15);
});

test('rate limit: ล็อกเฉพาะ IP ที่ผิด ไม่กระทบ IP อื่น', () => {
  const limiter = createLoginLimiter({ maxAttempts: 5, lockMinutes: 15 });
  for (let i = 0; i < 5; i += 1) limiter.fail('10.0.0.1');
  assert.equal(limiter.check('10.0.0.1').locked, true);
  assert.equal(limiter.check('10.0.0.2').locked, false);
});

test('rate limit: ปลดล็อกเองเมื่อครบ 15 นาที', () => {
  let now = 1_000_000;
  const limiter = createLoginLimiter({ maxAttempts: 5, lockMinutes: 15, now: () => now });
  for (let i = 0; i < 5; i += 1) limiter.fail('198.51.100.4');

  assert.equal(limiter.check('198.51.100.4').locked, true);
  now += 14 * 60 * 1000;
  assert.equal(limiter.check('198.51.100.4').locked, true, 'ผ่านไป 14 นาที ยังต้องล็อกอยู่');
  now += 61 * 1000;
  assert.equal(limiter.check('198.51.100.4').locked, false, 'ผ่านไป 15 นาทีแล้วต้องปลดล็อก');
});

test('rate limit: login สำเร็จต้องล้างตัวนับ', () => {
  const limiter = createLoginLimiter({ maxAttempts: 5, lockMinutes: 15 });
  limiter.fail('192.0.2.7');
  limiter.fail('192.0.2.7');
  limiter.reset('192.0.2.7');
  for (let i = 0; i < 4; i += 1) limiter.fail('192.0.2.7');
  assert.equal(limiter.check('192.0.2.7').locked, false, 'ตัวนับต้องเริ่มใหม่หลัง reset');
});
