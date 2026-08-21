'use strict';

const { Store } = require('express-session');

/**
 * เก็บ session ไว้ในตาราง sessions ของ SQLite
 * (ไม่ใช้ MemoryStore เพราะ session จะหายทุกครั้งที่ pm2 restart)
 */
function createSqliteStore(db, { cleanupIntervalMs = 15 * 60 * 1000 } = {}) {
  const stmt = {
    get: db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?'),
    set: db.prepare(
      `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
    ),
    destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?'),
    clear: db.prepare('DELETE FROM sessions'),
    count: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?'),
    prune: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  function expiryOf(session) {
    const ttl = session?.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
    return Date.now() + ttl;
  }

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = stmt.get.get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at <= Date.now()) {
          stmt.destroy.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.data));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, session, cb) {
      try {
        stmt.set.run(sid, JSON.stringify(session), expiryOf(session));
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        stmt.destroy.run(sid);
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    touch(sid, session, cb) {
      try {
        stmt.touch.run(expiryOf(session), sid);
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    clear(cb) {
      try {
        stmt.clear.run();
        return cb(null);
      } catch (err) {
        return cb(err);
      }
    }

    length(cb) {
      try {
        return cb(null, stmt.count.get(Date.now()).n);
      } catch (err) {
        return cb(err);
      }
    }
  }

  const store = new SqliteStore();
  stmt.prune.run(Date.now());

  if (cleanupIntervalMs > 0) {
    const timer = setInterval(() => {
      try {
        stmt.prune.run(Date.now());
      } catch {
        /* ไม่ต้องทำอะไร รอบหน้าค่อยลองใหม่ */
      }
    }, cleanupIntervalMs);
    timer.unref();
    store.stopCleanup = () => clearInterval(timer);
  }

  return store;
}

module.exports = { createSqliteStore };
