const { createApp } = require('../src/core/app');
const { tmpDbPath } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

function okSpawn() { return () => ({ ok: true, code: 0, stdout: 'Deployed', stderr: '' }); }

// Fast bcrypt stub so the auth paths stay deterministic in unit tests; the real
// bcryptjs module is still used in production. mirrors auth.js' injectable design.
function fastBcrypt() {
  return { hashSync: (pw) => 'H$' + pw, compareSync: (pw, h) => h === 'H$' + pw };
}

function makeApp(pathStr, extra) {
  return createApp(Object.assign({
    dbPath: pathStr,
    deploy: { spawn: okSpawn() },
    auth: { bcrypt: fastBcrypt(), rounds: 4 }
  }, extra || {}));
}

let app;
beforeEach(() => { app = makeApp(tmpDbPath('app')); });
afterEach(() => { try { app.close(); } catch (_) {} app = null; });

describe('app backend integration (Phase 10)', () => {
  test('wires all services around a migrated database', () => {
    const tables = app.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map(r => r.name).filter(n => !n.startsWith('sqlite_'));
    ['posts', 'dashboard', 'settings', 'deploy', 'backup', 'auth', 'env', 'db']
      .forEach(k => expect(app[k]).toBeDefined());
    expect(tables).toEqual(expect.arrayContaining(['posts', 'settings', 'deploy_logs']));
  });

  test('a published + a draft post drive the dashboard cards (PRD 8 #2)', () => {
    app.posts.createPost({ title: '发布一', content: '# Hi', status: 'published' });
    app.posts.createPost({ title: '草稿一', content: '?', status: 'draft' });
    expect(app.dashboard.getStats()).toEqual({ published: 1, draft: 1, scheduled: 0 });
    const activity = app.dashboard.getRecentActivity();
    expect(activity.length).toBe(2);
    expect(activity.map(a => a.title)).toContain('发布一');
  });

  test('theme persists across an app restart via close + recreate (PRD 8 #10)', () => {
    app.settings.setTheme('dark');
    app.close();
    const app2 = createApp({ dbPath: app.dbPath });
    expect(app2.settings.getTheme()).toBe('dark');
    app2.close();
  });

  test('configured deploy runs through the unified API and updates the dashboard (PRD 8 #8)', () => {
    app.settings.setBlogPath('E:/blog/hexo');
    app.settings.setDeployConfig({ repo_url: 'git@gh:me/x', branch: 'master' });
    const res = app.deploy.deploy();
    expect(res.ok).toBe(true);
    expect(res.entry.success).toBe(true);
    expect(app.deploy.totalDeploys()).toBe(1);
    expect(app.dashboard.getLatestDeployTime()).not.toBeNull();
    expect(app.dashboard.getSiteStatus().lastDeployAt).not.toBeNull();
  });

  test('environment detection is reachable through the app (PRD 8 #9)', () => {
    const runner = (cmd) => {
      if (cmd[0] === 'node') return { ok: true, stdout: 'v22.18.0\n', stderr: '' };
      if (cmd[0] === 'hexo') return { ok: true, stdout: 'hexo-cli: 4.3.2\n', stderr: '' };
      if (cmd[0] === 'git') return { ok: true, stdout: 'git version 2.51.0\n', stderr: '' };
      return { ok: false, stdout: '', stderr: '' };
    };
    const env = app.env.detectEnvironment(runner);
    expect(env.node.installed).toBe(true);
    expect(env.hexo.installed).toBe(true);
    expect(env.git.installed).toBe(true);
  });

  test('auth registers, logs in and out through the unified API (PRD 8 #1)', () => {
    expect(app.auth).toBeDefined();
    const u = app.auth.register({ username: 'alice', password: 'secret' });
    expect(u.username).toBe('alice');
    expect(app.auth.currentUser().username).toBe('alice');
    app.auth.logout();
    expect(app.auth.currentUser()).toBeNull();
    app.auth.login({ username: 'alice', password: 'secret' });
    expect(app.auth.currentUser().username).toBe('alice');
  });

  test('backup round-trips the whole app profile into a fresh instance (PRD 8 #12)', () => {
    app.posts.createPost({ title: '持久文章', content: 'C', status: 'published' });
    app.settings.setTheme('dark');
    app.settings.setBlogPath('E:/blog/hexo');
    app.settings.setDeployConfig({ repo_url: 'git@x', branch: 'main' });
    app.deploy.deploy();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-bak-'));
    const out = path.join(dir, 'snap.json');
    app.backup.exportToJson(out);

    const app2 = createApp({ dbPath: tmpDbPath('app2'), deploy: { spawn: okSpawn() } });
    const res = app2.backup.restore(out);
    expect(res.format).toBe('json');
    expect(app2.posts.listPosts().map(p => p.title)).toEqual(['持久文章']);
    expect(app2.settings.getTheme()).toBe('dark');
    expect(app2.settings.getDeployConfig().repo_url).toBe('git@x');
    expect(app2.dashboard.getStats().published).toBe(1);
    app2.close();
  });

  test('close disconnects the database', () => {
    app.close();
    expect(() => app.db.prepare('SELECT 1').get()).toThrow();
  });
});