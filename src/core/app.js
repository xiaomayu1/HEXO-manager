/**
 * App backend (PRD section 6) — composes every core service behind one API the
 * Electron main process wires to the renderer via IPC. This module is plain
 * Node.js (no Electron) so the cross-cutting integration is unit-tested.
 */
'use strict';

const { openDatabase } = require('./db');
const { createPostsService } = require('./posts');
const { createDashboardService } = require('./dashboard');
const { createSettingsService } = require('./settings');
const { createDeployService } = require('./deploy');
const { createBackupService } = require('./backup');
const { createScannerService } = require('./scanner');
const { createThemesService } = require('./themes');
const { createAuthService } = require('./auth');
const { createPreviewService } = require('./preview');
const { createPagesService } = require('./pages');
const { createMediaService } = require('./media');
const { createNoticeService } = require('./notice');
const { createMarketService } = require('./market');
const env = require('./env');

function defaultProfilePath() {
  const os = require('os');
  const path = require('path');
  return path.join(os.homedir(), 'HexoStudio', 'data.sqlite3');
}

function createApp(input) {
  const opts = (input && typeof input === 'object') ? input : {};
  const dbPath = opts.dbPath || defaultProfilePath();
  const db = openDatabase(dbPath);

  const settings = createSettingsService(db);
  const posts = createPostsService(db);
  const dashboard = createDashboardService(db);
  const deploy = createDeployService(db, settings, opts.deploy || {});
  const backup = createBackupService(db, dbPath);
  const scanner = createScannerService(posts, opts.scanner || {});
  const themes = createThemesService(opts.themes || {});
  const auth = createAuthService(db, opts.auth || {});
  // Preview service created without logger; main process wires win after app() returns
  const preview = createPreviewService(settings, env, opts.preview || {});
  const pages = createPagesService(settings, opts.pages || {});
  const media = createMediaService(db);
  const notices = createNoticeService(db);
  const market = createMarketService(opts.market || {});

  function close() {
    try { preview.close(); } catch (_) {}
    try { db.close(); } catch (_) {}
  }

  return { db, dbPath, posts, dashboard, settings, deploy, backup, scanner, themes, auth, preview, pages, media, notices, market, env, close };
}

module.exports = { createApp, defaultProfilePath };
