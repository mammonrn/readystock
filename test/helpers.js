'use strict';

const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const users = require('../src/services/users');

const TEST_CONFIG = {
  sessionSecret: 'test-secret-for-unit-tests',
  inviteCode: 'INVITE-TEST',
  cookieSecure: false,
  pageSize: 50,
  loginMaxAttempts: 5,
  loginLockMinutes: 15,
};

/** ฐานข้อมูลใหม่ในหน่วยความจำสำหรับแต่ละเทสต์ */
function freshDb() {
  return openDb(':memory:');
}

/** สร้างผู้ใช้สำหรับเทสต์ (คนแรกจะเป็น admin อัตโนมัติ) */
function makeUser(db, username, password = 'password123') {
  return users.register(db, {
    username,
    password,
    inviteCode: TEST_CONFIG.inviteCode,
    expectedInviteCode: TEST_CONFIG.inviteCode,
  });
}

/**
 * เปิดเซิร์ฟเวอร์จริงบนพอร์ตสุ่ม แล้วคืน client ที่จำ cookie ให้เอง
 * (ใช้เทสต์ flow ระดับ HTTP เช่น login, rate limit, export)
 */
async function startServer(db, configOverrides = {}) {
  const app = createApp({ db, config: { ...TEST_CONFIG, ...configOverrides } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function request(path, { method = 'GET', form, headers = {}, redirect = 'manual' } = {}) {
    const options = { method, redirect, headers: { ...headers } };
    if (cookie) options.headers.cookie = cookie;
    if (form) {
      options.headers['content-type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(form).toString();
    }
    const res = await fetch(base + path, options);
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookie) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('readystock.sid=')) cookie = pair;
    }
    return res;
  }

  /** ดึง csrf token จาก HTML ของหน้าที่กำหนด */
  async function csrfFrom(path) {
    const res = await request(path);
    const html = await res.text();
    const match = html.match(/name="_csrf" value="([^"]+)"/);
    return match ? match[1] : '';
  }

  /** POST พร้อมแนบ csrf token ที่ดึงมาจากหน้า formPath ให้อัตโนมัติ */
  async function post(path, form, formPath = path) {
    const _csrf = await csrfFrom(formPath);
    return request(path, { method: 'POST', form: { ...form, _csrf } });
  }

  async function login(username, password) {
    return post('/login', { username, password }, '/login');
  }

  return {
    base,
    request,
    post,
    csrfFrom,
    login,
    get cookie() {
      return cookie;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = { freshDb, makeUser, startServer, TEST_CONFIG };
