/**
 * Dashboard service (PRD 3 / 8 #2) — stat cards + recent activity timeline.
 */
'use strict';

function createDashboardService(db) {
  const stmtCountByStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM posts WHERE deleted_at IS NULL GROUP BY status`
  );
  const stmtAllActivePosts = db.prepare(
    `SELECT id, title, status, date, created_at, updated_at
     FROM posts WHERE deleted_at IS NULL ORDER BY datetime(updated_at) DESC`
  );
  const stmtLatestDeploy = db.prepare(
    `SELECT id, created_at, repo_url, branch, success FROM deploy_logs
     ORDER BY datetime(created_at) DESC LIMIT 1`
  );
  const stmtDeploysRecent = db.prepare(
    `SELECT id, created_at, repo_url, branch, success FROM deploy_logs
     ORDER BY datetime(created_at) DESC LIMIT ?`
  );
  const stmtSetting = db.prepare('SELECT value FROM settings WHERE key=?');

  function getStats() {
    const rows = stmtCountByStatus.all();
    const map = {};
    for (const r of rows) map[r.status] = r.n;
    return {
      published: map.published || 0,
      draft: map.draft || 0,
      scheduled: map.scheduled || 0
    };
  }

  function postActionLabel(status) {
    if (status === 'published') return '发布了文章';
    if (status === 'scheduled') return '安排了定时发布';
    return '创建了草稿';
  }

  function getRecentActivity(limit) {
    limit = limit || 20;
    const entries = [];

    for (const p of stmtAllActivePosts.all()) {
      entries.push({
        kind: 'post',
        time: p.updated_at,
        postId: p.id,
        title: p.title,
        text: postActionLabel(p.status) + '《' + p.title + '》'
      });
    }
    for (const d of stmtDeploysRecent.all(limit)) {
      entries.push({
        kind: 'deploy',
        time: d.created_at,
        deployId: d.id,
        success: d.success === 1,
        text: '执行了部署到 ' + (d.repo_url || '(未配置仓库)') +
          (d.branch ? '（' + d.branch + '）' : '') +
          (d.success === 1 ? ' — 成功' : ' — 失败')
      });
    }

    entries.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    return entries.slice(0, limit);
  }

  function getLatestDeployTime() {
    const row = stmtLatestDeploy.get();
    return row ? row.created_at : null;
  }

  function getSiteStatus() {
    const blogUrl = (stmtSetting.get('blog_url') || {}).value || '';
    const lastDeployAt = getLatestDeployTime();
    return { blogUrl, lastDeployAt };
  }

  return {
    getStats,
    getRecentActivity,
    getLatestDeployTime,
    getSiteStatus
  };
}

module.exports = { createDashboardService };
