'use strict';

const crypto = require('node:crypto');

// พารามิเตอร์ scrypt (ใช้ node:crypto ล้วน ๆ ไม่ต้อง compile native module บน VPS)
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** สร้าง hash รูปแบบ  scrypt$N$r$p$saltBase64$hashBase64 */
function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('ต้องระบุรหัสผ่าน');
  }
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/** ตรวจรหัสผ่านกับ hash ที่เก็บไว้ (เทียบแบบ timing-safe) */
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

/** ตรวจความถูกต้องของชื่อผู้ใช้ / รหัสผ่าน คืนข้อความ error ถ้าไม่ผ่าน */
function validateCredentials(username, password) {
  if (!username || username.trim().length < 3) return 'ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร';
  if (username.trim().length > 32) return 'ชื่อผู้ใช้ต้องยาวไม่เกิน 32 ตัวอักษร';
  if (!/^[a-zA-Z0-9._-]+$/.test(username.trim())) {
    return 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง';
  }
  if (!password || password.length < 6) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  if (password.length > 200) return 'รหัสผ่านยาวเกินไป';
  return null;
}

/**
 * ตัวจำกัดจำนวนครั้งที่ login ผิด (เก็บใน memory)
 * ผิดครบ maxAttempts ครั้ง => ล็อก IP นั้นไว้ lockMinutes นาที
 */
function createLoginLimiter({ maxAttempts = 5, lockMinutes = 15, now = Date.now } = {}) {
  const buckets = new Map(); // ip -> { count, lockedUntil }
  const lockMs = lockMinutes * 60 * 1000;

  function prune() {
    const t = now();
    for (const [ip, b] of buckets) {
      if (b.lockedUntil && b.lockedUntil <= t) buckets.delete(ip);
      else if (!b.lockedUntil && b.last && t - b.last > lockMs) buckets.delete(ip);
    }
  }

  return {
    /** @returns {{locked: boolean, retryAfterMinutes: number}} */
    check(ip) {
      const b = buckets.get(ip);
      if (!b || !b.lockedUntil) return { locked: false, retryAfterMinutes: 0 };
      const remain = b.lockedUntil - now();
      if (remain <= 0) {
        buckets.delete(ip);
        return { locked: false, retryAfterMinutes: 0 };
      }
      return { locked: true, retryAfterMinutes: Math.ceil(remain / 60000) };
    },
    /** บันทึกว่า login ผิดอีกครั้ง */
    fail(ip) {
      prune();
      const t = now();
      const b = buckets.get(ip) || { count: 0, lockedUntil: 0, last: t };
      b.count += 1;
      b.last = t;
      if (b.count >= maxAttempts) b.lockedUntil = t + lockMs;
      buckets.set(ip, b);
      return { attempts: b.count, remaining: Math.max(0, maxAttempts - b.count) };
    },
    /** ล้างสถิติเมื่อ login สำเร็จ */
    reset(ip) {
      buckets.delete(ip);
    },
    get size() {
      return buckets.size;
    },
  };
}

module.exports = { hashPassword, verifyPassword, validateCredentials, createLoginLimiter, SCRYPT };
