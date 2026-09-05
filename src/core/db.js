/**
 * SQLite data layer for Hexo Blog Manager.
 * Uses Node.js built-in `node:sqlite` (no native compilation).
 *
 * Schema: users, posts, settings, deploy_logs, user_oauth_accounts, media.
 */
'use strict';

const path = require('path');
const fs = require('fs');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  throw new Error('当前 Node.js 运行时未提供 node:sqlite 支持。');
}

const SCHEMA_MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  status     TEXT NOT NULL DEFAULT 'draft',
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_title  ON posts(title);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS deploy_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL,
  repo_url    TEXT    NOT NULL DEFAULT '',
  branch      TEXT    NOT NULL DEFAULT '',
  deploy_type TEXT    NOT NULL DEFAULT 'git',
  success     INTEGER NOT NULL DEFAULT 0,
  output      TEXT    NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_oauth_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  provider        TEXT    NOT NULL,
  provider_user_id TEXT   NOT NULL,
  access_token    TEXT    NOT NULL DEFAULT '',
  refresh_token   TEXT    NOT NULL DEFAULT '',
  token_expires_at TEXT,
  linked_at       TEXT    NOT NULL,
  UNIQUE(user_id, provider),
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  mime_type   TEXT    NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  base64      TEXT    NOT NULL DEFAULT '',
  path        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
`;

// Additive column migrations for databases created before display_name/bio existed.
function addMissingUserColumns(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('display_name')) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('bio')) {
    db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  }
}

// Additive column migration for posts: track the source .md filename.
function addMissingPostColumns(db) {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
  if (!cols.includes('source_file')) {
    db.exec("ALTER TABLE posts ADD COLUMN source_file TEXT NOT NULL DEFAULT ''");
  }
}

// Additive table migration for user_oauth_accounts.
function ensureOauthTable(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('user_oauth_accounts')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_oauth_accounts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        provider        TEXT    NOT NULL,
        provider_user_id TEXT   NOT NULL,
        access_token    TEXT    NOT NULL DEFAULT '',
        refresh_token   TEXT    NOT NULL DEFAULT '',
        token_expires_at TEXT,
        linked_at       TEXT    NOT NULL,
        UNIQUE(user_id, provider),
        UNIQUE(provider, provider_user_id)
      )
    `);
  }
}

function openDatabase(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_MIGRATION);
  addMissingUserColumns(db);
  addMissingPostColumns(db);
  ensureOauthTable(db);
  ensureMediaTable(db);
  ensureNoticesTable(db);
  return db;
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map(r => r.name);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// Additive table migration: media library may not exist in older DBs.
// Also handles column rename from old 'data_url' to 'base64'.
function ensureMediaTable(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('media')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS media (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        mime_type   TEXT    NOT NULL DEFAULT '',
        size        INTEGER NOT NULL DEFAULT 0,
        base64      TEXT    NOT NULL DEFAULT '',
        path        TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL
      )
    `);
    return;
  }
  // Migrate: old schema used 'data_url', new schema uses 'base64'
  const cols = db.prepare('PRAGMA table_info(media)').all().map(c => c.name);
  if (cols.includes('data_url') && !cols.includes('base64')) {
    // Create new table with correct columns, copy data, drop old
    db.exec(`
      CREATE TABLE _media_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        mime_type   TEXT    NOT NULL DEFAULT '',
        size        INTEGER NOT NULL DEFAULT 0,
        base64      TEXT    NOT NULL DEFAULT '',
        path        TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL
      )
    `);
    db.exec('INSERT INTO _media_new (id, name, mime_type, size, base64, path, created_at) SELECT id, name, mime_type, size, data_url, path, created_at FROM media');
    db.exec('DROP TABLE media');
    db.exec('ALTER TABLE _media_new RENAME TO media');
  }
}

// Additive table migration: notices may not exist in older DBs.
function ensureNoticesTable(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('notices')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notices (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        content     TEXT    NOT NULL DEFAULT '',
        priority    TEXT    NOT NULL DEFAULT 'normal',
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      )
    `);
  }
}

module.exports = { openDatabase, tableNames, tableColumns, DatabaseSync, ensureOauthTable, ensureMediaTable, ensureNoticesTable };
