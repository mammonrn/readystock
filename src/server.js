'use strict';

require('dotenv').config();

const { openDb } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3300;
const host = process.env.HOST || '127.0.0.1';

const db = openDb();
const app = createApp({ db });

const server = app.listen(port, host, () => {
  console.log(`[readystock] พร้อมใช้งานที่ http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[readystock] ได้รับสัญญาณ ${signal} กำลังปิดระบบ...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ปิดไปแล้ว */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
