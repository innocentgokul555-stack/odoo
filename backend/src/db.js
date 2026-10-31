const fs = require('fs');
const path = require('path');
const schema = require('./schema');

let current = null;

function openRaw(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const forceBuiltin = process.env.SQLITE_DRIVER === 'node';
  if (!forceBuiltin) {
    try {
      const BetterSqlite3 = require('better-sqlite3');
      return { raw: new BetterSqlite3(file), driver: 'better-sqlite3' };
    } catch (e) {
      // fall through to Node's built-in SQLite
    }
  }
  try {
    // Built into Node 22.5+. Used automatically if better-sqlite3 could not be installed.
    const { DatabaseSync } = require('node:sqlite');
    return { raw: new DatabaseSync(file), driver: 'node:sqlite' };
  } catch (e) {
    throw new Error(
      'No SQLite driver available. Install Node.js 22 or newer, or run "npm install" again in the backend folder.'
    );
  }
}

function init(file) {
  const { raw, driver } = openRaw(file);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec(schema);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };

  let depth = 0;
  const db = {
    driver,
    file,
    exec: (sql) => raw.exec(sql),
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => {
      const r = stmt(sql).run(...p);
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    // Wrap work in a transaction (nested calls become savepoints). Must not contain await.
    transaction(fn) {
      return (...args) => {
        if (depth === 0) {
          raw.exec('BEGIN IMMEDIATE');
          depth++;
          try {
            const out = fn(...args);
            raw.exec('COMMIT');
            return out;
          } catch (e) {
            raw.exec('ROLLBACK');
            throw e;
          } finally {
            depth--;
          }
        }
        const sp = `sp_${depth}`;
        raw.exec(`SAVEPOINT ${sp}`);
        depth++;
        try {
          const out = fn(...args);
          raw.exec(`RELEASE ${sp}`);
          return out;
        } catch (e) {
          raw.exec(`ROLLBACK TO ${sp}`);
          raw.exec(`RELEASE ${sp}`);
          throw e;
        } finally {
          depth--;
        }
      };
    },
    // Next human-friendly number, e.g. nextNumber('invoice', 'INV') -> INV-000042
    nextNumber(name, prefix) {
      db.run(
        'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1',
        name
      );
      const { value } = db.get('SELECT value FROM counters WHERE name = ?', name);
      return `${prefix}-${String(value).padStart(6, '0')}`;
    },
    close() { raw.close(); current = null; },
  };
  current = db;
  return db;
}

// Returns the open database (opens the default one on first use).
function getDb() {
  if (!current) init(require('./config').dbPath);
  return current;
}

module.exports = { init, getDb };
