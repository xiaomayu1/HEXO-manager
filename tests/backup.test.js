const { createBackupService } = require('../src/core/backup');
const { openDatabase } = require('../src/core/db');
const { tmpDbPath } = require('./helpers');
const os = require('os');
const fs = require('fs');
const path = require('path');

function seedBackup(db) {
  db.prepare('INSERT INTO posts (title, date, tags, categories, status, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('第一篇', '2026-01-01T00:00:00Z', '["hexo"]', '["blog"]', 'published', '# Hello', '2026-01-01', '2026-01-01');
  db.prepare('INSERT INTO posts (title, date, tags, categories, status, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('草稿一', '2026-02-01T00:00:00Z', '[]', '[]', 'draft', 'draft body', '2026-02-01', '2026-02-01');
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('theme', 'dark');
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('site_title', '我的博客');
  db.prepare('INSERT INTO deploy_logs (created_at, repo_url, branch, deploy_type, success, output, duration_ms) VALUES (?,?,?,?,?,?,?)')
    .run('2026-01-05T00:00:00Z', 'git@gh:x', 'master', 'git', 1, 'ok', 1200);
}

function signature(db) {
  const posts = db.prepare('SELECT id, title, tags, status, content FROM posts ORDER BY id').all()
    .map(p => ({ title: p.title, tags: JSON.parse(p.tags), status: p.status, content: p.content }));
  const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const deploys = db.prepare('SELECT COUNT(*) n, SUM(success) s FROM deploy_logs').get();
  return { posts, settings, deployCount: deploys.n, deploySuccess: deploys.s };
}

describe('backup & restore (Phase 9)', () => {
  let backupDir;
  beforeEach(() => { backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbm-bak-')); });

  test('exportToJson writes a readable envelope with all three tables (PRD 8 #12)', () => {
    const p = tmpDbPath('bak-json'); const db = openDatabase(p); seedBackup(db);
    const out = path.join(backupDir, 'snap.json');
    const res = createBackupService(db, p).exportToJson(out);
    expect(res.rows).toBe(5); // 2 posts + 2 settings + 1 deploy = 5
    const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(parsed.format).toBe('hexo-blog-manager-backup');
    expect(parsed.tables.posts.length).toBe(2);
    expect(parsed.tables.settings.length).toBe(2);
    expect(parsed.tables.deploy_logs.length).toBe(1);
    db.close();
  });

  test('round-trip JSON restore reconstructs the same data into a fresh DB', () => {
    const p1 = tmpDbPath('bak-src'); const db1 = openDatabase(p1); seedBackup(db1);
    const out = path.join(backupDir, 'snap.json');
    createBackupService(db1, p1).exportToJson(out);

    const db2 = openDatabase(tmpDbPath('bak-tgt2'));
    const res = createBackupService(db2, tmpDbPath('x')).restore(out);
    expect(res.format).toBe('json');
    expect(res.rowsRestored).toBe(5);
    expect(signature(db2)).toEqual(signature(db1));
    db1.close(); db2.close();
  });

  test('exportToBak writes a raw SQLite file (real binary backup)', () => {
    const p1 = tmpDbPath('bak-bin-src'); const db1 = openDatabase(p1); seedBackup(db1);
    const out = path.join(backupDir, 'snap.bak');
    const res = createBackupService(db1, p1).exportToBak(out);
    expect(res.rows).toBe(5);
    const head = fs.readFileSync(out).slice(0, 16).toString('latin1');
    expect(head.startsWith('SQLite format 3')).toBe(true);
    db1.close();
  });

  test('round-trip BAK restore reconstructs the same data into a fresh DB', () => {
    const p1 = tmpDbPath('bak-bin-src2'); const db1 = openDatabase(p1); seedBackup(db1);
    const out = path.join(backupDir, 'snap.bak');
    createBackupService(db1, p1).exportToBak(out);
    expect(fs.existsSync(out)).toBe(true);

    const db2 = openDatabase(tmpDbPath('bak-bin-tgt'));
    const res = createBackupService(db2, tmpDbPath('x')).restore(out);
    expect(res.format).toBe('bak');
    expect(signature(db2)).toEqual(signature(db1));
    db1.close(); db2.close();
  });

  test('restore overwrites existing data in the target (PRD 7 恢复覆盖)', () => {
    const p1 = tmpDbPath('bak-over-src'); const db1 = openDatabase(p1); seedBackup(db1);
    const out = path.join(backupDir, 'snap.json');
    createBackupService(db1, p1).exportToJson(out);

    const db2 = openDatabase(tmpDbPath('bak-over-tgt'));
    // target already has DIFFERENT data
    db2.prepare('INSERT INTO posts (title, date, tags, categories, status, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('TARGET ONLY', '1999-01-01', '[]', '[]', 'draft', 'x', '1999', '1999');
    createBackupService(db2, tmpDbPath('x')).restore(out);

    const titles = db2.prepare('SELECT title FROM posts ORDER BY id').all().map(r => r.title);
    expect(titles).toEqual(['第一篇', '草稿一']);
    expect(titles).not.toContain('TARGET ONLY');
    db1.close(); db2.close();
  });

  test('restore reports rowsRestored and rowsBefore counts', () => {
    const p1 = tmpDbPath('bak-cnt'); const db1 = openDatabase(p1); seedBackup(db1);
    const out = path.join(backupDir, 'snap.json');
    createBackupService(db1, p1).exportToJson(out);

    const db2 = openDatabase(tmpDbPath('bak-cnt-tgt'));
    db2.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('old', 'val');
    const res = createBackupService(db2, tmpDbPath('x')).restore(out);
    expect(res.rowsBefore).toBe(1);
    expect(res.rowsRestored).toBe(5);
    db1.close(); db2.close();
  });

  test('restore throws on a missing file', () => {
    const db = openDatabase(tmpDbPath('bak-bad1'));
    expect(() => createBackupService(db, tmpDbPath('x')).restore('nope.json')).toThrow(/备份文件不存在/);
    db.close();
  });

  test('restore throws on a bogus (non-JSON, non-SQLite) file', () => {
    const db = openDatabase(tmpDbPath('bak-bad2'));
    const bad = path.join(backupDir, 'bad.txt');
    fs.writeFileSync(bad, 'just a plain text file, not a backup');
    expect(() => createBackupService(db, tmpDbPath('x')).restore(bad)).toThrow();
    db.close();
  });
});

