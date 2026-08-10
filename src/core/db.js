/**
 * SQLite data layer for Hexo Blog Manager.
 * Uses Node.js built-in `node:sqlite` (no native compilation).
 *
 * Schema: users, posts, settings, deploy_logs.
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
`;

// Additive column migrations for databases created before display_name/bio existed.
// CREATE TABLE IF NOT EXISTS won't add columns to an existing table, so we ALTER
// conditionally based on the live column list.
function addMissingUserColumns(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('display_name')) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.includes('bio')) {
    db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
  }
}

// Additive column migration for posts: track the source .md filename so writes
// and deletes can target the hexo _posts file the post round-trips with.
function addMissingPostColumns(db) {
  const cols = db.prepare('PRAGMA table_info(posts)').all().map(c => c.name);
  if (!cols.includes('source_file')) {
    db.exec("ALTER TABLE posts ADD COLUMN source_file TEXT NOT NULL DEFAULT ''");
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
  return db;
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map(r => r.name);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

module.exports = { openDatabase, tableNames, tableColumns, DatabaseSync };
