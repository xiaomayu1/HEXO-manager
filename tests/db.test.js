const {
  openDatabase,
  tableNames,
  tableColumns,
} = require('../src/core/db');
const { tmpDbPath } = require('./helpers');

let db;
afterEach(() => { if (db) { db.close(); db = null; } });

describe('database layer (Phase 1)', () => {
  test('creates the required tables', () => {
    db = openDatabase(tmpDbPath());
    const tables = tableNames(db).filter(t => !t.startsWith('sqlite_'));
    expect(tables).toEqual(
      expect.arrayContaining(['posts', 'settings', 'deploy_logs'])
    );
  });

  test('posts table has the required columns from the PRD', () => {
    db = openDatabase(tmpDbPath());
    const cols = tableColumns(db, 'posts');
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'title', 'date', 'tags', 'categories', 'status', 'content'])
    );
  });

  test('settings is a key-value store', () => {
    db = openDatabase(tmpDbPath());
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('theme', 'dark');
    expect(db.prepare('SELECT value FROM settings WHERE key=?').get('theme').value).toBe('dark');
  });

  test('deploy_logs records deployments with success flag', () => {
    db = openDatabase(tmpDbPath());
    db.prepare('INSERT INTO deploy_logs (created_at, repo_url, branch, success, output) VALUES (?,?,?,?,?)')
      .run('2026-01-01', 'git@github.com:x/blog.git', 'master', 1, 'done');
    const row = db.prepare('SELECT * FROM deploy_logs').get();
    expect(row.success).toBe(1);
    expect(row.branch).toBe('master');
  });

  test('migration is idempotent (reopen does not error)', () => {
    const p = tmpDbPath();
    db = openDatabase(p); db.close(); db = null;
    db = openDatabase(p);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['posts', 'settings', 'deploy_logs'])
    );
  });

  test('creates the parent data directory if missing', () => {
    const p = tmpDbPath();
    db = openDatabase(p);
    expect(require('fs').existsSync(require('path').dirname(p))).toBe(true);
  });
});
