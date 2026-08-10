const { createSettingsService, THEMES } = require('../src/core/settings');
const { openDatabase } = require('../src/core/db');
const { tmpDbPath } = require('./helpers');

let db, settings;
beforeEach(() => { db = openDatabase(tmpDbPath('settings')); settings = createSettingsService(db); });
afterEach(() => { db.close(); db = null; settings = null; });

describe('settings service (Phase 5)', () => {
  test('get returns fallback for missing keys', () => {
    expect(settings.get('nope', 'default')).toBe('default');
    expect(settings.get('nope')).toBeUndefined();
  });

  test('set/get round trip and getAll', () => {
    settings.set('k1', 'v1');
    settings.set('k2', 'v2');
    expect(settings.get('k1')).toBe('v1');
    expect(settings.getAll()).toMatchObject({ k1: 'v1', k2: 'v2' });
  });

  test('remove deletes a key', () => {
    settings.set('temp', 'x');
    settings.remove('temp');
    expect(settings.get('temp')).toBeUndefined();
  });

  test('theme defaults to light', () => {
    expect(settings.getTheme()).toBe('light');
  });

  test('setTheme switches light -> dark and rejects invalid themes (PRD 8 #10)', () => {
    settings.setTheme('dark');
    expect(settings.getTheme()).toBe('dark');
    expect(() => settings.setTheme('purple')).toThrow();
    expect(settings.getTheme()).toBe('dark');
  });

  test('theme persists across app restart (close & reopen the DB) (PRD 10)', () => {
    const p = tmpDbPath('persist');
    const db1 = openDatabase(p);
    createSettingsService(db1).setTheme('dark');
    db1.close();
    const db2 = openDatabase(p);
    const s2 = createSettingsService(db2);
    expect(s2.getTheme()).toBe('dark');
    db2.close();
  });

  test('blog config accessors round trip', () => {
    settings.setBlogPath('E:/blog/hexo');
    settings.setSiteTitle('我的博客');
    settings.setBlogUrl('https://blog.example.com');
    settings.setBackupPath('E:/backups');
    expect(settings.getBlogPath()).toBe('E:/blog/hexo');
    expect(settings.getSiteTitle()).toBe('我的博客');
    expect(settings.getBlogUrl()).toBe('https://blog.example.com');
    expect(settings.getBackupPath()).toBe('E:/backups');
  });

  test('persisted blog/site config survives reopen', () => {
    const p = tmpDbPath('cfg-persist');
    const db1 = openDatabase(p);
    createSettingsService(db1).setSiteTitle('持久标题');
    db1.close();
    const db2 = openDatabase(p);
    expect(createSettingsService(db2).getSiteTitle()).toBe('持久标题');
    db2.close();
  });

  test('deploy config defaults to empty git config', () => {
    expect(settings.getDeployConfig()).toEqual({ repo_url: '', branch: '', deploy_type: 'git', domain: '' });
  });

  test('deploy config set merges with existing values', () => {
    settings.setDeployConfig({ repo_url: 'git@x', branch: 'master' });
    settings.setDeployConfig({ domain: 'blog.io' });
    const cfg = settings.getDeployConfig();
    expect(cfg).toEqual({ repo_url: 'git@x', branch: 'master', deploy_type: 'git', domain: 'blog.io' });
  });

  test('THEMES exposes the two supported themes', () => {
    expect(THEMES).toEqual(['light', 'dark']);
  });
});
