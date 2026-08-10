const { createDashboardService } = require('../src/core/dashboard');
const { makeDb } = require('./helpers');

let db, dash;
beforeEach(() => {
  db = makeDb('dash');
  dash = createDashboardService(db);
});
afterEach(() => { db.close(); db = null; dash = null; });

function insertPost(o) {
  db.prepare(
    `INSERT INTO posts (title, date, tags, categories, status, content, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?,?,?,?, NULL)`
  ).run(o.title, o.date, '[]', '[]', o.status, o.content || '',
    o.created_at || o.updated_at, o.updated_at);
}
function insertDeploy(o) {
  db.prepare(
    `INSERT INTO deploy_logs (created_at, repo_url, branch, deploy_type, success, output, duration_ms)
     VALUES (?,?,?,?,?,?,?)`
  ).run(o.created_at, o.repo_url || '', o.branch || '', o.deploy_type || 'git',
    o.success == null ? 1 : o.success, o.output || '', o.duration_ms || 0);
}

describe('dashboard service (Phase 4)', () => {
  test('empty dashboard: all zero stats and no activity', () => {
    expect(dash.getStats()).toEqual({ published: 0, draft: 0, scheduled: 0 });
    expect(dash.getRecentActivity()).toEqual([]);
    expect(dash.getLatestDeployTime()).toBeNull();
  });

  test('stat cards count published / draft / scheduled (PRD 3.1)', () => {
    insertPost({ title: 'p1', date: '2026-01-01', status: 'published', updated_at: '2026-01-01T00:00:00Z' });
    insertPost({ title: 'p2', date: '2026-01-02', status: 'published', updated_at: '2026-01-02T00:00:00Z' });
    insertPost({ title: 'd1', date: '2026-01-03', status: 'draft', updated_at: '2026-01-03T00:00:00Z' });
    insertPost({ title: 's1', date: '2026-02-01', status: 'scheduled', updated_at: '2026-01-04T00:00:00Z' });
    expect(dash.getStats()).toEqual({ published: 2, draft: 1, scheduled: 1 });
  });

  test('soft-deleted posts are excluded from stats', () => {
    insertPost({ title: 'p', date: '2026-01-01', status: 'published', updated_at: '2026-01-01T00:00:00Z' });
    db.prepare('UPDATE posts SET deleted_at=? WHERE 1').run('2026-01-02T00:00:00Z');
    expect(dash.getStats()).toEqual({ published: 0, draft: 0, scheduled: 0 });
  });

  test('recent activity is reverse chronological and merges posts + deploys', () => {
    insertPost({ title: '早起写的', date: '2026-01-01', status: 'draft', updated_at: '2026-01-01T08:00:00Z' });
    insertDeploy({ created_at: '2026-01-01T10:00:00Z', repo_url: 'git@x/y', branch: 'master', success: 1 });
    insertPost({ title: '晚点写的', date: '2026-01-01', status: 'published', updated_at: '2026-01-01T09:00:00Z' });
    const activity = dash.getRecentActivity(10);
    expect(activity.length).toBe(3);
    const times = activity.map(a => a.time);
    // newest first
    expect(times).toEqual([...times].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(activity[0].time).toBe('2026-01-01T10:00:00Z');
    expect(activity[0].kind).toBe('deploy');
    const last = activity[activity.length - 1];
    expect(last.kind).toBe('post');
    expect(last.title).toBe('早起写的');
  });

  test('recent activity respects the limit', () => {
    for (let i = 0; i < 8; i++) {
      insertPost({ title: 'p' + i, date: '2026-01-01', status: 'draft',
        updated_at: '2026-01-01T00:00:' + String(i).padStart(2, '0') + 'Z' });
    }
    expect(dash.getRecentActivity(3).length).toBe(3);
  });

  test('activity text for a deploy includes repo and success/failure', () => {
    insertDeploy({ created_at: '2026-01-01T10:00:00Z', repo_url: 'git@gh:me/x', branch: 'main', success: 0 });
    const [a] = dash.getRecentActivity(1);
    expect(a.text).toContain('git@gh:me/x');
    expect(a.text).toContain('main');
    expect(a.text).toContain('失败');
  });

  test('latest deploy time + site status (blog url + last deploy)', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?)').run('blog_url', 'https://blog.example.com');
    insertDeploy({ created_at: '2026-01-01T10:00:00Z' });
    insertDeploy({ created_at: '2026-02-01T10:00:00Z' });
    expect(dash.getLatestDeployTime()).toBe('2026-02-01T10:00:00Z');
    const status = dash.getSiteStatus();
    expect(status.blogUrl).toBe('https://blog.example.com');
    expect(status.lastDeployAt).toBe('2026-02-01T10:00:00Z');
  });

  test('site status blogUrl is empty when not configured', () => {
    expect(dash.getSiteStatus().blogUrl).toBe('');
  });
});
