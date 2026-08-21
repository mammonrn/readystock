'use strict';

const { hashPassword, verifyPassword, validateCredentials } = require('../auth');
const { AppError } = require('../errors');
const invites = require('./invites');

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}

function findByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

function findById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function listUsers(db) {
  return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
}

/**
 * สมัครสมาชิกใหม่ — ต้องใช้รหัสเชิญแบบสุ่มที่ผู้ดูแลระบบสร้างจากหน้า "จัดการระบบ"
 * รหัสหนึ่งรหัสใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง
 *
 * ข้อยกเว้น: ถ้ายังไม่มีผู้ใช้ในระบบเลย (ติดตั้งใหม่) ผู้ใช้คนแรกสมัครได้โดยไม่ต้องมีรหัสเชิญ
 * และได้สิทธิ์ admin อัตโนมัติ เพราะยังไม่มีใครสร้างรหัสเชิญให้ได้
 */
function register(db, { username, password, inviteCode }) {
  const name = String(username || '').trim();
  const invalid = validateCredentials(name, password);
  if (invalid) throw new AppError(invalid);

  const isFirstUser = countUsers(db) === 0;
  if (findByUsername(db, name)) throw new AppError('มีชื่อผู้ใช้นี้ในระบบแล้ว');

  const create = db.transaction(() => {
    // ตรวจรหัสเชิญก่อนสร้างผู้ใช้ ถ้ารหัสใช้ไม่ได้จะโยน error ออกไปโดยไม่สร้างอะไรเลย
    const invite = isFirstUser ? null : invites.assertUsable(db, inviteCode);

    const role = isFirstUser ? 'admin' : 'user';
    const info = db
      .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
      .run(name, hashPassword(password), role);

    if (invite) invites.markUsed(db, invite.id, info.lastInsertRowid);
    return findById(db, info.lastInsertRowid);
  });

  return create();
}

/** ตรวจ username/password คืน user ถ้าถูกต้อง ไม่ถูกคืน null */
function authenticate(db, username, password) {
  const user = findByUsername(db, username);
  if (!user) return null;
  if (!verifyPassword(String(password || ''), user.password_hash)) return null;
  return user;
}

function resetPassword(db, userId, newPassword) {
  const user = findById(db, userId);
  if (!user) throw new AppError('ไม่พบผู้ใช้');
  if (!newPassword || String(newPassword).length < 6) throw new AppError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), userId);
  return findById(db, userId);
}

function changeRole(db, userId, role, actingUserId) {
  if (!['admin', 'user'].includes(role)) throw new AppError('สิทธิ์ไม่ถูกต้อง');
  const user = findById(db, userId);
  if (!user) throw new AppError('ไม่พบผู้ใช้');
  if (Number(userId) === Number(actingUserId) && role !== 'admin') {
    throw new AppError('ไม่สามารถลดสิทธิ์ของตัวเองได้');
  }
  if (user.role === 'admin' && role !== 'admin' && countAdmins(db) <= 1) {
    throw new AppError('ต้องมีผู้ดูแลระบบ (admin) อย่างน้อย 1 คน');
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return findById(db, userId);
}

function deleteUser(db, userId, actingUserId) {
  const user = findById(db, userId);
  if (!user) throw new AppError('ไม่พบผู้ใช้');
  if (Number(userId) === Number(actingUserId)) throw new AppError('ไม่สามารถลบบัญชีของตัวเองได้');
  if (user.role === 'admin' && countAdmins(db) <= 1) {
    throw new AppError('ต้องมีผู้ดูแลระบบ (admin) อย่างน้อย 1 คน');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return user;
}

module.exports = {
  AppError,
  register,
  authenticate,
  findById,
  findByUsername,
  listUsers,
  countUsers,
  countAdmins,
  resetPassword,
  changeRole,
  deleteUser,
};
