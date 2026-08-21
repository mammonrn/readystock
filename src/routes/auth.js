'use strict';

const express = require('express');
const users = require('../services/users');
const { createLoginLimiter } = require('../auth');
const { setFlash } = require('../middleware');

function authRoutes(db, config) {
  const router = express.Router();
  const limiter = createLoginLimiter({
    maxAttempts: config.loginMaxAttempts,
    lockMinutes: config.loginLockMinutes,
  });

  function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  function safeNext(value) {
    // รับเฉพาะ path ภายในเว็บ กัน open redirect
    return typeof value === 'string' && /^\/(?!\/)/.test(value) ? value : '/items';
  }

  router.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/items');
    res.render('login', { title: 'เข้าสู่ระบบ', error: null, username: '', next: safeNext(req.query.next) });
  });

  router.post('/login', (req, res) => {
    const ip = clientIp(req);
    const nextUrl = safeNext(req.body.next);
    const username = String(req.body.username || '').trim();

    const state = limiter.check(ip);
    if (state.locked) {
      return res.status(429).render('login', {
        title: 'เข้าสู่ระบบ',
        error: `กรอกรหัสผ่านผิดหลายครั้งเกินไป กรุณารออีก ${state.retryAfterMinutes} นาทีแล้วลองใหม่`,
        username,
        next: nextUrl,
      });
    }

    const user = users.authenticate(db, username, req.body.password);
    if (!user) {
      const { remaining } = limiter.fail(ip);
      const hint = remaining > 0 ? ` (เหลืออีก ${remaining} ครั้งก่อนถูกล็อก ${config.loginLockMinutes} นาที)` : '';
      return res.status(401).render('login', {
        title: 'เข้าสู่ระบบ',
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' + hint,
        username,
        next: nextUrl,
      });
    }

    limiter.reset(ip);
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).render('login', {
          title: 'เข้าสู่ระบบ',
          error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่',
          username,
          next: nextUrl,
        });
      }
      req.session.userId = user.id;
      setFlash(req, 'success', `ยินดีต้อนรับ ${user.username}`);
      res.redirect(nextUrl);
    });
  });

  router.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/items');
    res.render('register', {
      title: 'สมัครสมาชิก',
      error: null,
      username: '',
      inviteCode: '',
      isFirstUser: users.countUsers(db) === 0,
    });
  });

  router.post('/register', (req, res) => {
    const username = String(req.body.username || '').trim();
    try {
      const user = users.register(db, {
        username,
        password: req.body.password,
        inviteCode: req.body.inviteCode,
      });
      req.session.regenerate((err) => {
        if (err) throw err;
        req.session.userId = user.id;
        setFlash(
          req,
          'success',
          user.role === 'admin'
            ? `สมัครสมาชิกสำเร็จ บัญชี ${user.username} เป็นผู้ใช้คนแรกจึงได้สิทธิ์ผู้ดูแลระบบ`
            : `สมัครสมาชิกสำเร็จ ยินดีต้อนรับ ${user.username}`
        );
        res.redirect('/items');
      });
    } catch (err) {
      if (!err.expected) throw err;
      res.status(400).render('register', {
        title: 'สมัครสมาชิก',
        error: err.message,
        username,
        inviteCode: String(req.body.inviteCode || '').trim(),
        isFirstUser: users.countUsers(db) === 0,
      });
    }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie(config.sessionName);
      res.redirect('/login');
    });
  });

  return router;
}

module.exports = authRoutes;
