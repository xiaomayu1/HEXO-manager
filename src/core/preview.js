/**
 * Local preview service (PRD 4.3) — manages a long-running `hexo server`
 * child process so the renderer can launch it and open the local preview URL
 * in the user's default system browser.
 *
 * The spawned child is injectable (opts.spawn) so behavior is unit-tested with
 * a fake process instead of a real hexo server. The blog path comes from the
 * settings service; hexo availability comes from the shared env module.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');

function defaultSpawner(cmd, args, opts) {
  return spawn(cmd, args, {
    cwd: opts && opts.cwd,
    shell: true,
    windowsHide: true
  });
}

function killTree(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true });
    }
  } catch (_) {}
  try { if (typeof proc.kill === 'function') proc.kill(); } catch (_) {}
}

function createPreviewService(settings, env, opts) {
  const spawnFn = (opts && opts.spawn) || defaultSpawner;
  const defaultPort = (opts && opts.port) || 4000;
  let child = null;
  let status = { running: false, url: '', pid: null, ready: false };

  function getStatus() { return Object.assign({}, status); }

  function getPort() {
    const raw = settings.get('preview_port', String(defaultPort));
    const n = parseInt(raw, 10);
    return (n && n > 0) ? n : defaultPort;
  }

  function start() {
    if (child) return { ok: false, error: '预览服务器已在运行', status: getStatus() };
    const blogPath = settings.getBlogPath();
    if (!blogPath) {
      return { ok: false, error: '尚未配置博客本地路径，请先在设置中配置', status: getStatus() };
    }
    const port = getPort();
    const url = 'http://localhost:' + port;
    try {
      child = spawnFn('hexo', ['server', '-p', String(port)], { cwd: blogPath });
    } catch (e) {
      child = null;
      return { ok: false, error: (e && e.message) ? e.message : '启动失败', status: getStatus() };
    }
    status = { running: true, url, pid: (child && child.pid) || null, ready: false };
    if (child && typeof child.on === 'function') {
      const markReady = (chunk) => { if (!status.ready) { if (/Hexo is running|is running at http/i.test(String(chunk || ''))) status.ready = true; } };
      if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', markReady);
      if (child.stderr && typeof child.stderr.on === 'function') child.stderr.on('data', markReady);
      child.on('error', () => { try { child && child.kill && child.kill(); } catch (_) {} });
      child.on('exit', () => { child = null; status = { running: false, url: '', pid: null, ready: false }; });
    }
    return { ok: true, status: getStatus() };
  }

  function stop() {
    if (!child) {
      status = { running: false, url: '', pid: null, ready: false };
      return { ok: false, error: '预览服务器未在运行', status: getStatus() };
    }
    killTree(child);
    child = null;
    status = { running: false, url: '', pid: null, ready: false };
    return { ok: true, status: getStatus() };
  }

  function close() {
    if (child) killTree(child);
    child = null;
    status = { running: false, url: '', pid: null, ready: false };
  }

  return { start, stop, getStatus, close };
}

module.exports = { createPreviewService, defaultSpawner };
