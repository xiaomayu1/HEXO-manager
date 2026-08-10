/**
 * Settings service (PRD 4.5 / 8 #10) — generic key/value store over the
 * settings table, plus typed accessors for theme, blog config and deploy config.
 */
'use strict';

const THEMES = ['light', 'dark'];

function createSettingsService(db) {
  const stmtGet = db.prepare('SELECT value FROM settings WHERE key=?');
  const stmtUpsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  );
  const stmtAll = db.prepare('SELECT key, value FROM settings');
  const stmtDelete = db.prepare('DELETE FROM settings WHERE key=?');

  function get(key, fallback) {
    const row = stmtGet.get(key);
    return row ? row.value : fallback;
  }

  function stringify(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function set(key, value) {
    stmtUpsert.run(key, stringify(value));
  }

  function getAll() {
    const obj = {};
    for (const r of stmtAll.all()) obj[r.key] = r.value;
    return obj;
  }

  function remove(key) { stmtDelete.run(key); }

  // ---- Theme ----
  function getTheme() {
    const t = get('theme', 'light');
    return THEMES.includes(t) ? t : 'light';
  }
  function setTheme(theme) {
    if (!THEMES.includes(theme)) {
      const e = new Error('invalid theme: ' + theme);
      e.code = 'INVALID_THEME';
      throw e;
    }
    set('theme', theme);
    return theme;
  }

  // ---- Blog config ----
  function getBlogPath() { return get('blog_path', ''); }
  function setBlogPath(p) { set('blog_path', p || ''); }
  function getSiteTitle() { return get('site_title', ''); }
  function setSiteTitle(t) { set('site_title', t || ''); }
  function getBlogUrl() { return get('blog_url', ''); }
  function setBlogUrl(u) { set('blog_url', u || ''); }
  function getBackupPath() { return get('backup_path', ''); }
  function setBackupPath(p) { set('backup_path', p || ''); }

  // ---- Deploy config (used by the deploy service in Phase 7) ----
  const DEFAULT_DEPLOY = { repo_url: '', branch: '', deploy_type: 'git', domain: '' };
  function getDeployConfig() {
    const raw = get('deploy_config', '');
    if (!raw) return { ...DEFAULT_DEPLOY };
    try {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_DEPLOY, ...parsed };
    } catch {
      return { ...DEFAULT_DEPLOY };
    }
  }
  function setDeployConfig(cfg) {
    const current = getDeployConfig();
    const next = { ...current, ...(cfg || {}) };
    set('deploy_config', JSON.stringify(next));
    return next;
  }

  return {
    get, set, getAll, remove,
    THEMES, getTheme, setTheme,
    getBlogPath, setBlogPath, getSiteTitle, setSiteTitle,
    getBlogUrl, setBlogUrl, getBackupPath, setBackupPath,
    getDeployConfig, setDeployConfig
  };
}

module.exports = { createSettingsService, THEMES };
