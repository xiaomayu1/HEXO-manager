/**
 * Backup & restore (PRD 7 / 8 #12).
 *
 *  - .json : human-readable envelope of all tables (format/version/tables).
 *  - .bak  : a raw byte copy of the SQLite database file (true binary backup),
 *            created after a WAL checkpoint so the copy is consistent.
 *
 * `restore()` auto-detects the format from the file contents and replays the
 * tables into the target database (clearing existing rows first), so the app's
 * state can be fully reconstructed from either file. The UI is expected to ask
 * the user for confirmation before overwriting current data (PRD 7).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BACKUP_FORMAT = 'hexo-blog-manager-backup';
const BACKUP_VERSION = 1;
const REQUIRED = ['posts', 'settings', 'deploy_logs'];
const TABLES = ['users', 'posts', 'settings', 'deploy_logs'];

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

function requireTables(db) {
  for (const t of REQUIRED) if (!tableExists(db, t)) {
    throw new Error('备份文件缺少表：' + t);
  }
}

function countRows(envelope) {
  let n = 0;
  for (const t of TABLES) n += (envelope.tables[t] || []).length;
  return n;
}

function collectEnvelope(db) {
  requireTables(db);
  const tables = {};
  for (const t of TABLES) {
    // ORDER BY rowid works for every table (settings has no `id` column).
    if (!tableExists(db, t)) { tables[t] = []; continue; }
    tables[t] = db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all();
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: new Date().toISOString(), tables };
}

function applyEnvelope(db, envelope) {
  if (!envelope || !envelope.tables) throw new Error('无效的备份文件');
  let inTx = false;
  try {
    db.exec('BEGIN');
    inTx = true;
    for (const t of TABLES) {
      db.exec('DELETE FROM ' + t);
      const rows = Array.isArray(envelope.tables[t]) ? envelope.tables[t] : [];
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        db.prepare('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + placeholders + ')')
          .run(...cols.map(c => row[c]));
      }
    }
    db.exec('COMMIT');
    inTx = false;
  } catch (e) {
    if (inTx) { try { db.exec('ROLLBACK'); } catch (_) {} }
    throw new Error('恢复失败：' + (e && e.message ? e.message : String(e)));
  }
}

function rowCounts(envelope) {
  const r = {};
  for (const t of TABLES) r[t] = (envelope.tables[t] || []).length;
  return r;
}

function exportToJson(db, destPath) {
  const envelope = collectEnvelope(db);
  const text = JSON.stringify(envelope, null, 2);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, text, 'utf8');
  return { path: destPath, bytes: Buffer.byteLength(text), rows: countRows(envelope), rowsByTable: rowCounts(envelope) };
}

function exportToBak(db, dbPath, destPath) {
  if (!dbPath) throw new Error('备份需要数据库文件路径');
  if (!fs.existsSync(dbPath)) throw new Error('数据库文件不存在：' + dbPath);
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(dbPath, destPath);
  const stat = fs.statSync(destPath);
  return { path: destPath, bytes: stat.size, rows: countRows(collectEnvelope(db)), rowsByTable: rowCounts(collectEnvelope(db)) };
}

function restore(db, sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('备份文件不存在：' + sourcePath);
  }
  let envelope = null;
  let fromJson = false;

  // 1) try JSON envelope first
  try {
    const txt = fs.readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(txt);
    if (parsed && parsed.tables) { envelope = parsed; fromJson = true; }
  } catch (_) {
    envelope = null; // not JSON -> treat as raw SQLite
  }

  // 2) otherwise treat as a raw SQLite database file
  if (!envelope) {
    let src;
    try {
      src = new DatabaseSync(sourcePath, { readOnly: true });
    } catch (e) {
      throw new Error('无法读取备份文件（既非 JSON 也非 SQLite）：' + (e && e.message ? e.message : ''));
    }
    try { requireTables(src); } catch (e) { src.close(); throw e; }
    try { envelope = collectEnvelope(src); } finally { src.close(); }
  }

  const before = countRows(collectEnvelope(db));
  applyEnvelope(db, envelope);
  const after = countRows(envelope);
  return { format: fromJson ? 'json' : 'bak', rowsRestored: after, rowsBefore: before };
}

function createBackupService(db, dbPath) {
  return {
    TABLES, BACKUP_FORMAT, BACKUP_VERSION,
    exportToJson: (dest) => exportToJson(db, dest),
    exportToBak: (dest) => exportToBak(db, dbPath, dest),
    restore: (src) => restore(db, src),
    collectEnvelope: () => collectEnvelope(db)
  };
}

module.exports = {
  createBackupService,
  collectEnvelope, applyEnvelope, exportToJson, exportToBak, restore,
  BACKUP_FORMAT, BACKUP_VERSION, TABLES
};
