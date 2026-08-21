'use strict';

const crypto = require('node:crypto');

/** ต้อง login ก่อนถึงจะเข้าหน้าอื่นได้ */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  const target = req.originalUrl && req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect('/login' + target);
}

/** เฉพาะผู้ใช้ที่มี role = admin */
function requireAdmin(req, res, next) {
  if (res.locals.currentUser && res.locals.currentUser.role === 'admin') return next();
  return res.status(403).render('error', {
    title: 'ไม่มีสิทธิ์เข้าถึง',
    message: 'หน้านี้สำหรับผู้ดูแลระบบ (admin) เท่านั้น',
    status: 403,
  });
}

/** แนบข้อมูล user ปัจจุบันและข้อความแจ้งเตือนเข้า res.locals ให้ทุกหน้าใช้ */
function attachUser(db, users) {
  return function (req, res, next) {
    res.locals.currentUser = null;
    if (req.session && req.session.userId) {
      const user = users.findById(db, req.session.userId);
      if (user) {
        res.locals.currentUser = { id: user.id, username: user.username, role: user.role };
      } else {
        // ผู้ใช้ถูกลบไปแล้ว -> เคลียร์ session ทิ้ง
        req.session.userId = null;
      }
    }
    res.locals.flash = req.session ? req.session.flash || null : null;
    if (req.session) req.session.flash = null;
    res.locals.activePath = req.path;
    res.locals.query = req.query || {};
    next();
  };
}

/** สร้าง token กัน CSRF ต่อ session และตรวจทุก request ที่ไม่ใช่ GET */
function csrf(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('base64url');
  }
  res.locals.csrfToken = req.session ? req.session.csrfToken : '';

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session ? req.session.csrfToken : '';
  const ok =
    typeof sent === 'string' &&
    sent.length > 0 &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) {
    return res.status(403).render('error', {
      title: 'คำขอไม่ถูกต้อง',
      message: 'เซสชันหมดอายุหรือแบบฟอร์มไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',
      status: 403,
    });
  }
  return next();
}

/** ตั้งข้อความแจ้งเตือนไว้แสดงหลัง redirect */
function setFlash(req, type, message) {
  if (req.session) req.session.flash = { type, message };
}

module.exports = { requireAuth, requireAdmin, attachUser, csrf, setFlash };
