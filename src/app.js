'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');

const users = require('./services/users');
const { createSqliteStore } = require('./session-store');
const { requireAuth, attachUser, csrf } = require('./middleware');
const { thaiTime } = require('./format');
const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const logRoutes = require('./routes/logs');
const adminRoutes = require('./routes/admin');

function resolveConfig(overrides = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    sessionSecret: process.env.SESSION_SECRET || '',
    sessionName: 'readystock.sid',
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
    pageSize: Number(process.env.PAGE_SIZE) || 50,
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS) || 5,
    loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES) || 15,
    ...overrides,
  };
}

/**
 * สร้าง Express app
 * @param {object} options
 * @param {import('better-sqlite3').Database} options.db ฐานข้อมูลที่เปิดไว้แล้ว
 */
function createApp({ db, config: configOverrides } = {}) {
  if (!db) throw new Error('createApp ต้องได้รับ db');
  const config = resolveConfig(configOverrides);
  if (!config.sessionSecret) {
    throw new Error('ยังไม่ได้ตั้งค่า SESSION_SECRET ในไฟล์ .env (ดูตัวอย่างที่ .env.example)');
  }

  const app = express();
  app.set('trust proxy', 1); // อยู่หลัง nginx reverse proxy
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');
  app.locals.appName = 'ReadyStock';
  app.locals.thaiTime = thaiTime;

  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  // health check ต้องเรียกได้โดยไม่ต้อง login และไม่ต้องแตะ session
  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'error', message: err.message });
    }
  });

  app.use(
    session({
      name: config.sessionName,
      secret: config.sessionSecret,
      store: createSqliteStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.cookieSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      },
    })
  );

  app.use(attachUser(db, users));
  app.use(csrf);

  app.use(authRoutes(db, config));
  app.use(requireAuth, itemRoutes(db, config));
  app.use(requireAuth, logRoutes(db, config));
  app.use(requireAuth, adminRoutes(db, config));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'ไม่พบหน้านี้', message: 'ไม่พบหน้าที่คุณเรียก', status: 404 });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[readystock]', err);
    if (res.headersSent) return;
    res.status(500).render('error', {
      title: 'เกิดข้อผิดพลาด',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง หากยังไม่หายให้แจ้งผู้ดูแลระบบ',
      status: 500,
    });
  });

  app.locals.config = config;
  return app;
}

module.exports = { createApp, resolveConfig };
