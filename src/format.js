'use strict';

/**
 * แปลงเวลาที่ SQLite เก็บไว้ (UTC รูปแบบ 'YYYY-MM-DD HH:MM:SS') เป็นเวลาไทยที่อ่านง่าย
 * เช่น '2026-08-21 12:30:00' -> '21/08/2026 19:30'
 */
function thaiTime(sqlUtc) {
  if (!sqlUtc) return '-';
  const date = new Date(String(sqlUtc).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return String(sqlUtc);
  return new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

module.exports = { thaiTime };
