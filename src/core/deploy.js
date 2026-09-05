/**
 * Deploy service (PRD 4.4 / 8 #8) — configure repo+branch, run `hexo deploy`,
 * record history with success/failure, and report results.
 *
 * Process execution is injectable (opts.spawn) so behavior is unit-tested
 * against a fake spawner instead of a real hexo process.
 */
'use strict';

const { defaultSpawnSync } = require('./utils');

function createDeployService(db, settings, opts) {
  const spawn = (opts && opts.spawn) || defaultSpawnSync;

  const stmtInsertLog = db.prepare(
    `INSERT INTO deploy_logs
       (created_at, repo_url, branch, deploy_type, success, output, duration_ms)
     VALUES (?,?,?,?,?,?,?)`
  );
  const stmtGetLog = db.prepare('SELECT * FROM deploy_logs WHERE id=?');
  const stmtHistory = db.prepare(
    `SELECT * FROM deploy_logs ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`
  );
  const stmtLatest = db.prepare(
    `SELECT * FROM deploy_logs ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`
  );
  const stmtCountAll = db.prepare('SELECT COUNT(*) AS n FROM deploy_logs');
  const stmtUpsertSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );

  function toPublic(row) {
    if (!row) return null;
    return {
      id: row.id,
      created_at: row.created_at,
      repo_url: row.repo_url,
      branch: row.branch,
      deploy_type: row.deploy_type,
      success: row.success === 1,
      output: row.output,
      duration_ms: row.duration_ms
    };
  }

  function getConfig() { return settings.getDeployConfig(); }
  function setConfig(cfg) { return settings.setDeployConfig(cfg || {}); }

  function deploy(extra) {
    extra = extra || {};
    const cfg = getConfig();
    const blogPath = settings.getBlogPath();

    if (!cfg.repo_url) {
      return { ok: false, error: '尚未配置部署仓库，请先在设置中配置仓库地址与分支', entry: null };
    }
    if (!blogPath) {
      return { ok: false, error: '尚未配置博客本地路径，请先在设置中设置博客路径', entry: null };
    }

    const started = Date.now();
    const cwd = blogPath;
    const timeout = extra.timeout || 120000;
    // 标准 hexo 部署链路：clean(清旧产物) → generate(重新生成静态站点) → deploy(推到仓库)
    // clean 在无 public/db.json 时会报错，属正常无害，故其失败不中断。
    const steps = [
      { label: 'hexo clean',    args: ['clean'],    optional: true },
      { label: 'hexo generate', args: ['generate'] },
      { label: 'hexo deploy',   args: ['deploy'] }
    ];
    const outParts = [];
    let failed = null;
    for (const step of steps) {
      const r = spawn('hexo', step.args, { cwd, timeout });
      const seg = ((r.stdout || '').trim() + ((r.stderr && r.stderr.trim()) ? ((r.stdout || '').trim() ? '\n' : '') + r.stderr.trim() : '')).trim();
      if (seg) outParts.push('[' + step.label + ']\n' + seg);
      if (!r.ok) {
        if (step.optional) continue;
        failed = r; failed.step = step.label; break;
      }
    }
    const duration = Date.now() - started;
    const createdAt = new Date().toISOString();
    const ok = !failed;
    const combined = outParts.join('\n\n');
    const errMsg = failed ? (failed.error || (failed.stderr && failed.stderr.trim()) || '部署未完成（失败于 ' + failed.step + '）') : '';

    const info = stmtInsertLog.run(
      createdAt, cfg.repo_url, cfg.branch || '', cfg.deploy_type || 'git',
      ok ? 1 : 0, combined, duration
    );
    const entry = toPublic(stmtGetLog.get(info.lastInsertRowid));
    stmtUpsertSetting.run('last_deploy', createdAt);

    return { ok, code: failed ? failed.code : 0, error: errMsg, output: combined, duration_ms: duration, entry };

  }

  function history(limit) { return stmtHistory.all(limit || 50).map(toPublic); }
  function latestDeploy() { return toPublic(stmtLatest.get()); }
  function totalDeploys() { return stmtCountAll.get().n; }

  return { getConfig, setConfig, deploy, history, latestDeploy, totalDeploys };
}

module.exports = { createDeployService };
