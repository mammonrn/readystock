'use strict';

const { hashPassword, verifyPassword, validateCredentials } = require('../auth');

class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
    this.expected = true;
  }
}

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
 * สมัครสมาชิกใหม่ — ต้องกรอกรหัสเชิญให้ตรงกับ INVITE_CODE
 * ผู้ใช้คนแรกของระบบจะได้สิทธิ์ admin โดยอัตโนมัติ
 */
function register(db, { username, password, inviteCode, expectedInviteCode }) {
  const name = String(username || '').trim();
  const invalid = validateCredentials(name, password);
  if (invalid) throw new AppError(invalid);

  if (!expectedInviteCode) throw new AppError('ระบบยังไม่ได้ตั้งค่ารหัสเชิญ (INVITE_CODE) กรุณาติดต่อผู้ดูแล');
  if (String(inviteCode || '').trim() !== String(expectedInviteCode)) throw new AppError('รหัสเชิญไม่ถูกต้อง');

  if (findByUsername(db, name)) throw new AppError('มีชื่อผู้ใช้นี้ในระบบแล้ว');

  const role = countUsers(db) === 0 ? 'admin' : 'user';
  const info = db
    .prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(name, hashPassword(password), role);
  return findById(db, info.lastInsertRowid);
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
