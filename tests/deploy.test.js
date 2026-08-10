const { createDeployService } = require('../src/core/deploy');
const { createSettingsService } = require('../src/core/settings');
const { openDatabase } = require('../src/core/db');
const { tmpDbPath } = require('./helpers');

let db, settings, deploy;
beforeEach(() => {
  db = openDatabase(tmpDbPath('deploy'));
  settings = createSettingsService(db);
});
afterEach(() => { db.close(); db = null; });

function makeDeploy(spawner) {
  return createDeployService(db, settings, { spawn: spawner });
}

function okSpawner(stdout) {
  return () => ({ ok: true, code: 0, stdout: stdout || 'Deployed', stderr: '', error: '' });
}
function failSpawner() {
  return () => ({ ok: false, code: 1, stdout: '', stderr: 'deploy failed', error: '' });
}

describe('deploy service (Phase 7)', () => {
  test('getConfig returns default empty config', () => {
    deploy = makeDeploy(okSpawner());
    expect(deploy.getConfig()).toEqual({ repo_url: '', branch: '', deploy_type: 'git', domain: '' });
  });

  test('setConfig persists and merges repo + branch (PRD 4.4)', () => {
    deploy = makeDeploy(okSpawner());
    deploy.setConfig({ repo_url: 'git@github.com:me/blog.git', branch: 'master' });
    expect(deploy.getConfig().repo_url).toBe('git@github.com:me/blog.git');
    expect(deploy.getConfig().branch).toBe('master');
  });

  test('deploy refuses without a configured repo and records no history', () => {
    deploy = makeDeploy(okSpawner());
    const res = deploy.deploy();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/配置部署仓库/);
    expect(res.entry).toBeNull();
    expect(deploy.totalDeploys()).toBe(0);
  });

  test('deploy refuses without a blog path and records no history', () => {
    deploy = makeDeploy(okSpawner());
    settings.setDeployConfig({ repo_url: 'git@x' });
    const res = deploy.deploy();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/博客本地路径/);
    expect(deploy.totalDeploys()).toBe(0);
  });

  test('successful deploy records a success entry and clear result (PRD 8 #8)', () => {
    settings.setBlogPath('E:/blog/hexo');
    settings.setDeployConfig({ repo_url: 'git@github.com:me/blog.git', branch: 'master' });
    deploy = makeDeploy(okSpawner('INFO  Deployed to git@github.com:me/blog.git\n'));
    const res = deploy.deploy();
    expect(res.ok).toBe(true);
    expect(res.entry).not.toBeNull();
    expect(res.entry.success).toBe(true);
    expect(res.entry.repo_url).toBe('git@github.com:me/blog.git');
    expect(res.entry.branch).toBe('master');
    expect(res.entry.output).toContain('Deployed');
    expect(typeof res.duration_ms).toBe('number');
    expect(deploy.totalDeploys()).toBe(1);
  });

  test('failed deploy records a failure entry with the error output', () => {
    settings.setBlogPath('E:/blog/hexo');
    settings.setDeployConfig({ repo_url: 'git@x', branch: 'main' });
    deploy = makeDeploy(failSpawner());
    const res = deploy.deploy();
    expect(res.ok).toBe(false);
    expect(res.entry.success).toBe(false);
    expect(res.entry.output).toContain('deploy failed');
    expect(deploy.totalDeploys()).toBe(1);
  });

  test('history returns newest first and latestDeploy reflects the last attempt', () => {
    settings.setBlogPath('E:/blog/hexo');
    settings.setDeployConfig({ repo_url: 'git@x', branch: 'b1' });
    deploy = makeDeploy(okSpawner('first'));
    deploy.deploy();
    // force a distinct later timestamp
    db.prepare('UPDATE deploy_logs SET created_at=? WHERE id=(SELECT MAX(id) FROM deploy_logs)')
      .run('2020-01-01T00:00:00Z');
    deploy = makeDeploy(okSpawner('second'));
    deploy.deploy();
    db.prepare('UPDATE deploy_logs SET created_at=? WHERE id=(SELECT MAX(id) FROM deploy_logs)')
      .run('2026-01-01T00:00:00Z');
    const history = deploy.history(10);
    expect(history.length).toBe(2);
    expect(history[0].created_at).toBe('2026-01-01T00:00:00Z');
    expect(deploy.latestDeploy().created_at).toBe('2026-01-01T00:00:00Z');
  });

  test('deploy writes last_deploy into settings for the dashboard', () => {
    settings.setBlogPath('E:/blog/hexo');
    settings.setDeployConfig({ repo_url: 'git@x', branch: 'main' });
    deploy = makeDeploy(okSpawner());
    deploy.deploy();
    expect(settings.get('last_deploy')).toBeTruthy();
  });
});
