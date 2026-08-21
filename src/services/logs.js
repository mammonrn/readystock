'use strict';

/** บันทึกกิจกรรมลงตาราง activity_logs */
function addLog(db, { userId, action, itemName, detail = '' }) {
  const info = db
    .prepare('INSERT INTO activity_logs (user_id, action, item_name, detail) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, action, itemName, detail);
  return info.lastInsertRowid;
}

/** ดึงประวัติกิจกรรมแบบแบ่งหน้า (ใหม่สุดขึ้นก่อน) */
function listLogs(db, { page = 1, perPage = 50 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM activity_logs').get().n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = db
    .prepare(
      `SELECT l.*, COALESCE(u.username, 'ผู้ใช้ที่ถูกลบ') AS username
         FROM activity_logs l
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.id DESC
        LIMIT ? OFFSET ?`
    )
    .all(perPage, (current - 1) * perPage);
  return { rows, total, pages, page: current, perPage };
}

module.exports = { addLog, listLogs };
