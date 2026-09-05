/**
 * Local preview service — manages a long-running `hexo server` child process.
 *
 * 设计原则：
 *   1. 直接启动 hexo server，不跑 hexo clean（干净快速）
 *   2. 用端口可连判定服务就绪（比文本匹配更可靠）
 *   3. 所有日志通过 onLog 回调返回，渲染器可实时显示
 *   4. 进程异常时清楚区分原因（端口占用 / hexo 未安装 / 目录不存在）
 */
'use strict';

const { spawn } = require('child_process');
const net       = require('net');

// ── 辅助：杀掉进程树（Windows taskkill /T，POSIX kill -9）──────────────────
function killTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try { require('child_process').spawnSync('taskkill',
        ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch (_) {}
  }
  try { if (typeof proc.kill === 'function') proc.kill('SIGTERM'); } catch (_) {}
}

// ── 检查进程是否仍在运行（按 PID）───────────────────────────────────────────
function isProcessAlive(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    try {
      const r = require('child_process').spawnSync('tasklist',
        ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 3000 });
      return r.stdout.toString().toLowerCase().indexOf(String(pid).toLowerCase()) >= 0;
    } catch (_) { return false; }
  }
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// ── 辅助：等待端口可连（最多 waitMs ms）──────────────────────────────────────
function waitForPort(port, waitMs = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { clearTimeout(timer); resolve(false); }, waitMs);
    const sock = new net.Socket();
    sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve(true); });
    sock.on('error',   () => { clearTimeout(timer); sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

// ── 辅助：检测端口是否空闲（同时测试 127.0.0.1 和 0.0.0.0 两种绑定）─────────
// 有些服务（如 LiteLLM）绑定 0.0.0.0 而不绑定 127.0.0.1，
// 只测试 loopback 会漏判，导致 hexo server 绑定在同一端口时两者互相影响。
// 检测端口是否空闲：两个 socket 并行绑定，任一失败即认为占用
// 关键：不能先 close 一个再绑定另一个，否则 Windows 上端口会立即释放
async function isPortFree(port) {
  const tryBind = (addr) => new Promise((resolve) => {
    const s = net.createServer();
    s.on('listening', () => { s.close(); resolve(true); });
    s.on('error',     () => { s.close(); resolve(false); });
    s.listen(port, addr);
  });
  // Windows 上 close 后端口不会立即释放，需要等待
  const localFree = await tryBind('127.0.0.1');
  if (!localFree) return false;
  // 短暂等待端口释放后再测试 0.0.0.0
  await new Promise((r) => setTimeout(r, 50));
  return await tryBind('0.0.0.0');
}

// ── 辅助：找空闲端口（从 startPort 起顺次探测）──────────────────────────────
async function findFreePort(startPort, maxTries = 30) {
  for (let p = startPort; p < startPort + maxTries; p++) {
    if (await isPortFree(p)) return p;
  }
  return -1;
}

// ── 主工厂函数 ─────────────────────────────────────────────────────────────
function createPreviewService(settings, env, opts) {
  const onLog  = (opts && typeof opts.onLog === 'function') ? opts.onLog : () => {};
  const spawnFn = (opts && opts.spawn) || ((cmd, args, o) => spawn(cmd, args, { ...o, shell: true, windowsHide: true }));
  const defaultPort = (opts && opts.port) ? parseInt(opts.port, 10) : 4000;

  let child      = null;   // 当前 hexo server 进程
  let port       = -1;     // 当前使用的端口
  let pending    = false;  // 防止并发 start
  let aborted    = false;  // stop/close 触发，阻断后续操作
  let status     = { running: false, url: '', pid: null, ready: false };

  function log(msg)       { onLog({ msg: String(msg || ''), time: Date.now() }); }
  // 清理僵尸进程：child 指向已死的进程时恢复空闲状态
  function cleanupZombie() {
    if (child && child.pid && !isProcessAlive(child.pid)) {
      log('检测到已终止的进程 pid=' + child.pid + '，清理状态');
      child = null;
      status = { running: false, url: '', pid: null, ready: false };
      pending = false;
    }
  }

  function getStatus()     { return { running: !!child, url: port > 0 ? 'http://localhost:' + port : '', pid: child ? child.pid : null, ready: !!child }; }

  // ── 启动预览 ──────────────────────────────────────────────────────────────
  async function start() {
    cleanupZombie();
    if (pending) return { ok: false, error: '预览已在启动中，请稍候…', status: getStatus() };
    if (child && isProcessAlive(child.pid)) return { ok: false, error: '预览服务器已在运行', status: getStatus() };
    // 进程已死（僵尸），强制清理
    if (child) {
      log('检测到已终止的进程 pid=' + child.pid + '，已自动清理');
      child = null;
      port = -1;
      status = { running: false, url: '', pid: null, ready: false };
      pending = false;
    }

    const blogPath = settings.getBlogPath();
    if (!blogPath) return { ok: false, error: '尚未配置博客本地路径，请先在设置中设置', status: getStatus() };

    pending = true;
    aborted = false;

    try {
      // 1. 找空闲端口
      const candidate = settings.get('preview_port', String(defaultPort));
      const startPort = parseInt(candidate, 10) || defaultPort;
      port = await findFreePort(startPort);
      if (port < 0) {
        throw new Error('无法找到空闲端口（' + startPort + '–' + (startPort + 19) + ' 均被占用），请关闭占用程序后重试。');
      }
      log('找到空闲端口 ' + port);

      // 2. 保存端口设置（下次优先复用）
      settings.set('preview_port', String(port));

      // 3. 启动 hexo server
      log('正在启动 hexo server -p ' + port + ' …');
      child = spawnFn('hexo', ['server', '-p', String(port)], { cwd: blogPath });
      status = { running: true, url: 'http://localhost:' + port, pid: child.pid, ready: false };

      // 绑定进程事件
      child.on('spawn',   () => log('hexo 子进程已创建（pid=' + child.pid + '）'));
      child.on('error',   (err) => {
        log('子进程错误：' + err.message);
        child = null;
        status = { running: false, url: '', pid: null, ready: false };
        pending = false;
      });
      child.on('close',   (code, signal) => {
        log('子进程退出 code=' + code + ' signal=' + signal);
        child = null;
        status = { running: false, url: '', pid: null, ready: false };
        pending = false;
        // 自动打开浏览器（仅在正常退出时不处理，error 已由上面处理）
      });

      // stdout/stderr 透传日志
      if (child.stdout) child.stdout.on('data', (chunk) => {
        const s = String(chunk).trim();
        if (s) log('[stdout] ' + s);
      });
      if (child.stderr) child.stderr.on('data', (chunk) => {
        const s = String(chunk).trim();
        if (s) log('[stderr] ' + s);
      });

      // 4. 等待端口可连（表示服务就绪）
      log('等待服务器就绪…');
      const ready = await waitForPort(port, 30000);
      if (!ready) {
        throw new Error('hexo server 启动超时（30s），可能端口未成功监听，请查看上方日志。');
      }
      log('预览就绪 → http://localhost:' + port);
      pending = false;

      // 5. 自动打开浏览器
      try { require('electron').shell.openExternal('http://localhost:' + port); } catch (_) {}

      return { ok: true, status: getStatus() };

    } catch (e) {
      log('启动失败：' + e.message);
      pending = false;
      child = null;
      status = { running: false, url: '', pid: null, ready: false };
      return { ok: false, error: e.message, status: getStatus() };
    }
  }

  // ── 停止预览 ──────────────────────────────────────────────────────────────
  function stop() {
    if (!child) return { ok: false, error: '预览服务器未在运行', status: getStatus() };
    aborted = true;
    log('正在停止预览…');
    killTree(child);
    child = null;
    port = -1;
    pending = false;
    status = { running: false, url: '', pid: null, ready: false };
    log('预览已停止');
    return { ok: true, status: getStatus() };
  }

  // ── 清理（应用退出时调用）──────────────────────────────────────────────────
  function close() {
    aborted = true;
    pending = false;
    if (child) killTree(child);
    child = null;
    port = -1;
    status = { running: false, url: '', pid: null, ready: false };
  }

  // 允许外部（main process）在 win 就绪后接入日志转发
  let _onLog = opts && typeof opts.onLog === 'function' ? opts.onLog : () => {};
  function setOnLog(fn) { _onLog = (typeof fn === 'function') ? fn : () => {}; }
  return { start, stop, getStatus, close, setOnLog };
}

module.exports = { createPreviewService };
