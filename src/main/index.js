'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { createApp } = require('../core/app');
const { parseFrontMatter } = require('../core/scanner');
const { recipeFor, listRecipePackages } = require('../core/pluginRecipes');
const { highlightYaml } = require('../core/yamlHighlight');

const sync = { slugify: require('../core/syncHexo').slugify, writePostFile: require('../core/syncHexo').writePostFile, deletePostFile: require('../core/syncHexo').deletePostFile };

// 简单 HTML 转义，用于 data URL 中的 title 属性
function esc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

let win = null;
let previewWin = null;          // Markdown 预览独立窗口
let backend = null;
let previewF11Hook = false;     // 由渲染器经 preview:setF11Hook 开关；仅在预览页劫持 F11
let oAuthWin = null;            // OAuth 授权窗口（隐藏，等待回调）
let oAuthResolver = null;       // 当前待 resolve 的 OAuth 回调 Promise

// ensure the backend is cleanly shut down (database closed) before the app quits.
function shutdownBackend() {
  if (!backend) return;
  try { backend.close(); } catch (_) {}
  backend = null;
}
// 关闭 Markdown 预览窗口
function closePreviewWin() {
  if (previewWin) { previewWin.close(); previewWin = null; }
}
// 关闭 OAuth 授权窗口
function closeOAuthWin() {
  if (oAuthWin && !oAuthWin.closed) { oAuthWin.close(); }
  oAuthWin = null;
}
// 处理自定义协议回调 hexostudio://oauth/callback?...
function handleOAuthCallback(url) {
  const info = parseOAuthCallback(url);
  if (!info) return;
  // Close the OAuth window since callback came through protocol
  closeOAuthWin();
  if (info.error) {
    if (win) win.webContents.send('oauth:error', info.error);
    return;
  }
  if (info.code && win) {
    win.webContents.send('oauth:callback', { code: info.code, state: info.state });
  }
}

function dbPath() {
  return path.join(app.getPath('userData'), 'data.sqlite3');
}

function blogPathOf() {
  return backend.settings.getBlogPath();
}

// 把单篇文章按 hexo 格式写到博客的 source/_posts/<source_file>；无博客路径则跳过。
function syncHexoWrite(post) {
  const bp = blogPathOf();
  if (!bp) return { skipped: true, reason: '未配置博客本地路径，文章仅存于软件库' };
  if (!post || !post.source_file) return { skipped: true, reason: '该文章无关联文件' };
  return sync.writePostFile({}, bp, post);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#ffffff',
    title: 'Hexo 博客管家',
    icon: path.join(__dirname, '..', 'renderer', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  // 接入预览日志转发：当 win 就绪后将 onLog 回调绑定到 webContents.send
  if (backend && backend.preview && typeof backend.preview.setOnLog === 'function') {
    backend.preview.setOnLog((msg) => {
      if (win && win.webContents && msg && typeof msg === 'object' && msg.msg) {
        win.webContents.send('preview:log', msg);
      }
    });
  }
  // webContents 级按键拦截：iframe 获得焦点后外层 document 收不到键盘事件，
  // 这里在分发前捕获，仅当渲染器开启劫持时拦 F11，转发给渲染器切换预览全屏。
  win.webContents.on('before-input-event', (event, input) => {
    if (previewF11Hook && input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.webContents.send('preview:f11');
    }
  });
}

// OAuth: open authorize URL in a hidden BrowserWindow, receive callback via custom protocol
function openOAuthWindow(authorizeUrl, callback) {
  const oauthWin = new BrowserWindow({
    width: 480, height: 640,
    title: 'OAuth 登录',
    modal: !!win,
    parent: win,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  oauthWin.loadURL(authorizeUrl);
  oauthWin.once('close', () => {
    // If window closed without callback, reject
    setTimeout(() => { if (!oauthWin.closed) callback(null); }, 2000);
  });
  return oauthWin;
}

// Parse hexostudio://oauth/callback?code=...&state=... from argv or open-url event
function parseOAuthCallback(url) {
  if (!url || !url.startsWith('hexostudio://')) return null;
  try {
    const u = new URL(url);
    if (u.pathname !== '/oauth/callback') return null;
    return {
      code: u.searchParams.get('code'),
      state: u.searchParams.get('state'),
      error: u.searchParams.get('error')
    };
  } catch (_) { return null; }
}

// -- IPC wiring: delegate every request to the tested backend services --
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return await fn(...args); }
    catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  });
}

function registerIpc() {
  const a = backend;
  // -- auth: local user system (login / registration, PRD 4.1 / 8 #1) --
  handle('auth:register', (i) => ({ ok: true, user: a.auth.register(i) }));
  handle('auth:login', (i) => ({ ok: true, user: a.auth.login(i) }));
  handle('auth:logout', () => { a.auth.logout(); return { ok: true }; });
  handle('auth:currentUser', () => ({ ok: true, user: a.auth.currentUser() }));
  handle('auth:listUsers', () => ({ ok: true, users: a.auth.listUsers() }));
  handle('auth:getProfile', () => ({ ok: true, profile: a.auth.getProfile() }));
  handle('auth:updateProfile', (i) => ({ ok: true, profile: a.auth.updateProfile(i) }));
  handle('auth:changePassword', (i) => { a.auth.changePassword(i); return { ok: true }; });

  // -- OAuth: third-party account binding --
  handle('auth:getAuthorizeUrl', (provider) => {
    try {
      const url = a.auth.getAuthorizeUrl(String(provider || ''), crypto.randomUUID());
      return { ok: true, url };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('auth:oAuthStart', async (provider) => {
    try {
      const url = a.auth.getAuthorizeUrl(String(provider || ''), crypto.randomUUID());
      // Open the authorize URL in a hidden window that will receive the callback
      const win2 = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      win2.loadURL(url);
      oAuthWin = win2;
      // Return the URL so renderer can show a loading indicator
      return { ok: true, url };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('auth:oAuthCallback', (input) => {
    // Called when custom protocol fires with hexostudio://oauth/callback?...
    const info = parseOAuthCallback(String(input || ''));
    if (!info) return { ok: false, error: '无效的 OAuth 回调地址' };
    if (info.error) return { ok: false, error: '授权失败: ' + (info.error_description || info.error) };
    if (!info.code) return { ok: false, error: '未收到授权码' };
    // Send code to renderer for exchange
    if (win) win.webContents.send('oauth:callback', { code: info.code, state: info.state });
    return { ok: true };
  });
  handle('auth:exchangeOAuthCode', async (input) => {
    const i = input || {};
    const provider = String(i.provider || '').toLowerCase();
    const code = String(i.code || '');
    if (!code) return { ok: false, error: '未收到授权码' };
    try {
      const cfg = a.auth.getOAuthConfig(provider);
      const clientId = (opts && opts.oauth && opts.oauth[provider] && opts.oauth[provider].clientId) || '';
      const clientSecret = (opts && opts.oauth && opts.oauth[provider] && opts.oauth[provider].clientSecret) || '';
      if (!clientId) return { ok: false, error: '未配置 ' + provider + ' 的 Client ID，请在「设置」中配置' };
      // Exchange code for token via POST
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: (opts && opts.oauthRedirectUri) || 'hexostudio://oauth/callback',
        client_id: clientId,
        client_secret: clientSecret
      });
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: form.toString()
      });
      if (!tokenRes.ok) return { ok: false, error: '授权码兑换失败，请重试' };
      const tokenData = await tokenRes.json();
      if (tokenData.error) return { ok: false, error: tokenData.error_description || tokenData.error };
      // Fetch user info from provider
      const userInfoRes = await fetch(cfg.userInfoUrl, {
        headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
      });
      if (!userInfoRes.ok) return { ok: false, error: '获取用户信息失败' };
      const userInfo = await userInfoRes.json();
      const providerUserId = String(userInfo.id || userInfo.login || userInfo.username || '');
      if (!providerUserId) return { ok: false, error: '无法获取第三方用户 ID' };
      // Link / auto-login
      const linked = a.auth.linkAccount({
        provider, access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        provider_user_id: providerUserId,
        expires_in: tokenData.expires_in || null
      });
      // Find or create local user account
      const existing = a.auth.findByProviderUser(provider, providerUserId);
      if (existing) {
        a.auth.session.set({ id: existing.id, username: existing.username });
        return { ok: true, user: a.auth.currentUser(), linked, autoCreated: false };
      }
      // Auto-create local account (username = provider_user_id)
      const newUser = a.auth.register({ username: providerUserId, password: 'oauth-' + providerUserId, confirm: 'oauth-' + providerUserId });
      a.auth.session.set({ id: newUser.id, username: newUser.username });
      return { ok: true, user: a.auth.currentUser(), linked, autoCreated: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  });
  handle('auth:listLinkedAccounts', () => ({ ok: true, accounts: a.auth.listLinkedAccounts() }));
  handle('auth:unlinkAccount', (provider) => {
    try { a.auth.unlinkAccount(String(provider || '')); return { ok: true }; }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('auth:isLinked', (provider) => ({ ok: true, linked: a.auth.isLinked(String(provider || '')) }));
  handle('posts:create', (i) => {
    const post = a.posts.createPost(i);
    return { ok: true, post: post, sync: syncHexoWrite(post) };
  });
  handle('posts:update', (id, i) => {
    const existing = a.posts.getPost(id);
    if (!existing) return { ok: false, error: '文章不存在或已被删除', post: null, sync: { skipped: true } };
    let next = i || {};
    // 标题改了，按新标题重算文件名；删除旧文件、写入新文件（用户选择"删旧文件、按新标题写新文件"）
    if (next.title && String(next.title).trim() !== existing.title) {
      next = Object.assign({}, next, { source_file: sync.slugify(next.title.trim()) + '.md' });
    }
    const post = a.posts.updatePost(id, next);
    let s;
    const blogPath = blogPathOf();
    if (post && blogPath) {
      if (post.source_file && existing.source_file && post.source_file !== existing.source_file) {
        sync.deletePostFile({}, blogPath, existing.source_file, existing.status);
      }
      s = sync.writePostFile({}, blogPath, post);
    } else {
      s = { skipped: true, reason: blogPath ? '' : '未配置博客本地路径，文章仅存于软件库' };
    }
    return { ok: !!post, post: post, sync: s };
  });
  handle('posts:delete', (id) => {
    const existing = a.posts.getPost(id);
    const deleted = a.posts.deletePost(id);
    let s;
    const blogPath = blogPathOf();
    if (deleted && existing && existing.source_file && blogPath) {
      s = sync.deletePostFile({}, blogPath, existing.source_file, existing.status);
    } else {
      s = { skipped: true, reason: (!blogPath || !existing) ? '' : '该文章无关联文件' };
    }
    return { ok: true, deleted: deleted, sync: s };
  });
  handle('posts:get', (id) => ({ ok: true, post: a.posts.getPost(id) }));
  handle('posts:list', () => ({ ok: true, posts: a.posts.listPosts() }));
  handle('posts:search', (q) => ({ ok: true, posts: a.posts.searchPosts(q) }));
  handle('posts:filterByStatus', (s) => ({ ok: true, posts: a.posts.filterByStatus(s) }));
  handle('posts:listTags', () => ({ ok: true, tags: a.posts.listTags() }));
  handle('posts:listCategories', () => ({ ok: true, categories: a.posts.listCategories() }));

  handle('dashboard:stats', () => ({ ok: true, stats: a.dashboard.getStats() }));
  handle('dashboard:activity', (limit) => ({ ok: true, activity: a.dashboard.getRecentActivity(limit) }));
  handle('dashboard:siteStatus', () => ({ ok: true, status: a.dashboard.getSiteStatus() }));

  handle('settings:get', (k, d) => ({ ok: true, value: a.settings.get(k, d) }));
  handle('settings:set', (k, v) => { a.settings.set(k, v); return { ok: true }; });
  handle('settings:getTheme', () => ({ ok: true, theme: a.settings.getTheme() }));
  handle('settings:setTheme', (t) => { a.settings.setTheme(t); return { ok: true, theme: a.settings.getTheme() }; });
  handle('settings:getCustomCss', () => ({ ok: true, css: a.settings.getCustomCss() }));
  handle('settings:setCustomCss', (c) => ({ ok: true, css: a.settings.setCustomCss(c || {}) }));
  handle('settings:getBackground', () => ({ ok: true, bg: a.settings.getBackground() }));
  handle('settings:setBackground', (c) => {
    const cfg = c || {};
    // If a dataUrl was provided, store it; otherwise keep existing url
    const existing = a.settings.getBackground();
    const nextUrl = cfg.dataUrl && String(cfg.dataUrl).trim() ? String(cfg.dataUrl) : (cfg.url || existing.url || '');
    const result = a.settings.setBackground({ ...cfg, url: nextUrl });
    return { ok: true, bg: result };
  });
  handle('settings:clearBackground', () => ({ ok: true, bg: a.settings.clearBackground() }));
  handle('settings:blogConfig', (cfg) => ({
    ok: true,
    blogPath: a.settings.getBlogPath(),
    siteTitle: a.settings.getSiteTitle(),
    blogUrl: a.settings.getBlogUrl()
  }));

  handle('deploy:getConfig', () => ({ ok: true, config: a.deploy.getConfig() }));
  handle('deploy:setConfig', (c) => ({ ok: true, config: a.deploy.setConfig(c) }));
  handle('deploy:deploy', () => a.deploy.deploy());
  handle('deploy:history', (limit) => ({ ok: true, history: a.deploy.history(limit) }));
  handle('deploy:latest', () => ({ ok: true, deploy: a.deploy.latestDeploy() }));

  // scan an existing hexo blog and import its source/_posts/*.md into the store
  handle('scanner:scan', () => a.scanner.scan(blogPathOf()));

  // themes & plugins management (operate on the configured blog path)
  handle('themes:list', () => a.themes.listThemes(blogPathOf()));
  handle('themes:activate', (theme) => a.themes.activateTheme(blogPathOf(), theme));
  handle('themes:uninstall', (theme) => a.themes.uninstallTheme(blogPathOf(), theme));
  handle('themes:install', (name) => a.themes.installTheme(blogPathOf(), name));
  handle('themes:listArchivedConfigs', () => a.themes.listArchivedConfigs(blogPathOf()));
  handle('themes:archiveConfig', (theme) => a.themes.archiveConfig(blogPathOf(), theme));
  handle('themes:restoreArchivedConfig', (theme) => a.themes.restoreArchivedConfig(blogPathOf(), theme));
  handle('plugins:list', () => {
    const r = a.themes.listPlugins(blogPathOf());
    if (r.ok && r.plugins) r.plugins.forEach(p => { p.hasRecipe = !!recipeFor(p.name); });
    return r;
  });
  handle('plugins:install', (pkg) => a.themes.installPlugin(blogPathOf(), pkg));
  handle('plugins:uninstall', (pkg) => a.themes.uninstallPlugin(blogPathOf(), pkg));
  handle('plugins:listRecipePackages', () => ({ ok: true, packages: listRecipePackages() }));
  handle('config:read', (fileName) => {
    try {
      const bp = blogPathOf();
      const fn = String(fileName || '_config.yml');
      const text = a.themes.readBlogConfigFile(bp, fn);
      // 空（0 字节）的主题覆盖配置 _config.<theme>.yml：优先用主题自带 themes/<theme>/_config.yml
      // 作为起点回填到编辑器（保存即写入根目录覆盖文件，Hexo 原生的 _config.<theme>.yml 约定）；
      // 主题未安装则给出清晰说明而非沉默空白。站点 _config.yml 不在此回填。
      if (String(text == null ? '' : text).trim() === '') {
        const m = /^_config\.(.+)\.ya?ml$/i.exec(fn);
        if (m) {
          const theme = m[1];
          const bundled = path.join(bp, 'themes', theme, '_config.yml');
          let seed = null;
          try { const cc = fs.readFileSync(bundled, 'utf8'); if (cc && String(cc).trim()) seed = cc; } catch (_) {}
          if (seed) {
            return { ok: true, text: seed, seeded: true, sourceFile: fn,
              note: '当前文件为空（0 字节），已自动载入主题自带配置 themes/' + theme + '/_config.yml 作为起点。保存即写入根目录的 ' + fn + '（Hexo 主题覆盖配置）；若不需要可直接删除该空文件。' };
          }
          return { ok: true, text: '', sourceFile: fn,
            note: '当前文件为空（0 字节）。Hexo 的 ' + fn + ' 是可选的主题覆盖配置，默认无需存在；且未在 themes/' + theme + '/ 找到主题自带配置可回填。可直接在此编辑后保存以创建，或删除此历史残留的空文件。' };
        }
      }
      return { ok: true, text: text || '' };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('config:write', (text, fileName) => {
    try { return a.themes.writeBlogConfigFile(blogPathOf(), fileName || '_config.yml', String(text == null ? '' : text)); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });

  // 主题级配置 _config.<theme>.yml 读写（写前同样自动备份）—— 交接文档 §2.2
  handle('config:readTheme', () => {
    try { return a.themes.readThemeConfig(blogPathOf()); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('config:writeTheme', (text) => {
    try { return a.themes.writeThemeConfig(blogPathOf(), String(text == null ? '' : text)); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('config:readThemeByName', (themeName) => {
    try {
      const bp = blogPathOf();
      const target = String(themeName || '').trim();
      if (!target) return { ok: false, error: '请提供主题名称' };
      const p = path.join(bp, '_config.' + target + '.yml');
      return { ok: true, theme: target, content: fs.readFileSync(p, 'utf8') };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  handle('config:readArchived', (themeName, file) => {
    try {
      const bp = blogPathOf();
      const ts = new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', '-');
      const defaultFile = 'config.' + (themeName || '') + '.' + ts + '.yml';
      const targetFile = file || defaultFile;
      const p = path.join(bp, 'themes', '.theme_configs', targetFile);
      return { ok: true, theme: themeName, content: fs.readFileSync(p, 'utf8'), fileName: targetFile };
    } catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  // 编辑系统可用配置文件清单：_config.yml + 所有 _config.<theme>.yml（交接文档 §2.2 扩展）
  handle('config:list', () => {
    try { return a.themes.listBlogConfigFiles(blogPathOf()); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });
  // 确保主题配置文件存在（若不存在则创建空文件），返回文件名供编辑器直接加载
  handle('config:initThemeFile', () => {
    try {
      const bp = blogPathOf();
      const cfg = a.themes.readBlogConfig(bp);
      const theme = a.themes.parseActiveTheme(cfg.text || '');
      if (!theme) return { ok: true, theme: '', fileName: null };
      const fileName = '_config.' + theme + '.yml';
      const fsx = require('fs');
      const fullPath = path.join(bp, fileName);
      if (!fsx.existsSync(fullPath)) {
        fsx.writeFileSync(fullPath, '', 'utf8');
      }
      return { ok: true, theme: theme, fileName: fileName };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  });
  // 通用编辑器「恢复备份」：参数可为 'site'/'theme'/任意 _config*.yml 文件名，只读回内容供核对，绝不覆盖原文件（安全红线 §四）
  handle('config:readBackup', (key) => {
    try { return a.themes.readConfigBackup(blogPathOf(), key || 'site'); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  });


  // 只读高亮：汇集工具处汋后返回 HTML（纯函数 yamlHighlight 在主进程执行，可单测）
  handle('config:highlight', (t) => ({ ok: true, html: highlightYaml(String(t == null ? '' : t)) }));

  // 配方：先预演（dry-run）给用户看，确认后再应用 —— 交接文档 §3.4 / §八
  handle('plugins:previewRecipe', (pkg) => a.themes.planRecipe(blogPathOf(), pkg));
  handle('plugins:applyRecipe', (pkg) => a.themes.applyRecipe(blogPathOf(), pkg));

  // structured onboarding guide (first-run environment checks + install steps)
  handle('preview:setF11Hook', (on) => { previewF11Hook = !!on; return { ok: true }; });

  handle('env:guide', () => ({ ok: true, guide: a.env.buildGuide(a.env.detectEnvironment()) }));

  // 一键安装 Hexo CLI（环境检测后未发现 hexo 时使用；需要系统已安装 Node/npm）
  handle('env:installHexo', () => {
    const info = a.env.detectEnvironment();
    if (!info.node.installed) return { ok: false, error: '未检测到 Node.js，无法用 npm 安装 Hexo。请先安装 Node.js（https://nodejs.org）。' };
    let stdout = '', stderr = '';
    try {
      const r = spawnSync('npm', ['install', '-g', 'hexo-cli'], { encoding: 'utf8', shell: true, timeout: 180000 });
      stdout = r.stdout || ''; stderr = r.stderr || '';
      if (r.status !== 0) return { ok: false, error: 'npm 安装失败（退出码 ' + r.status + '）：' + (stderr || stdout).slice(0, 400) };
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : '安装执行出错' };
    }
    const after = a.env.detectEnvironment();
    return { ok: !!after.hexo.installed, hexoInstalled: !!after.hexo.installed, version: after.hexo.version, stdout: stdout.slice(-600), stderr: stderr.slice(-600) };
  });

  // 记住密码：本地保存凭据以支持下次自动登录（退出登录会清除）
  handle('auth:rememberLogin', (i) => {
    const c = i || {};
    const u = String(c.username || ''); const p = String(c.password || '');
    if (!u || !p) return { ok: false, error: '凭据不完整' };
    a.settings.set('remember_login', Buffer.from(JSON.stringify({ username: u, password: p })).toString('base64'));
    return { ok: true };
  });
  handle('auth:clearRemembered', () => { a.settings.set('remember_login', ''); return { ok: true }; });
  handle('auth:tryRememberedLogin', () => {
    const raw = a.settings.get('remember_login', '');
    if (!raw) return { ok: false, username: '' };
    let cred;
    try { cred = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (_) { return { ok: false, username: '' }; }
    if (!cred || !cred.username || !cred.password) return { ok: false, username: '' };
    try {
      const user = a.auth.login({ username: cred.username, password: cred.password });
      return { ok: true, user: user, username: cred.username };
    } catch (e) {
      return { ok: false, username: cred.username, error: (e && e.message) ? e.message : '' };
    }
  });

  // local browser preview: start/stop a `hexo server` child process and open
  // its URL in the user's default system browser (PRD 4.3).
  // Fast async PATH check: when Hexo is missing, `hexo server` spawned with
  // shell:true exits non-zero instead of throwing — start() would wrongly report
  // "running" and the renderer would show a blank iframe. Gate it first and return
  // installable guidance the renderer can act on (reuses env:installHexo).
  // Cache hexo availability to avoid repeated 4s detection on each preview start.
  let _hexoAvailableCache = null;
  let _hexoAvailableTime = 0;
  const HEXO_CACHE_TTL = 60000; // 1 minute cache
  function hexoAvailable() {
    const now = Date.now();
    if (_hexoAvailableCache !== null && now - _hexoAvailableTime < HEXO_CACHE_TTL) {
      return Promise.resolve(_hexoAvailableCache);
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (done) return;
        done = true;
        _hexoAvailableCache = val;
        _hexoAvailableTime = now;
        resolve(val);
      };
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      let proc;
      try { proc = spawn(cmd, ['hexo'], { shell: true, windowsHide: true }); }
      catch (e) { return finish(false); }
      const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} finish(false); }, 4000);
      proc.on('error', () => { clearTimeout(timer); finish(false); });
      proc.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
    });
  }
  handle('preview:start', async () => {
    if (!(await hexoAvailable())) {
      return { ok: false, error: '未检测到 Hexo CLI，无法启动预览。可点击下方「一键安装 Hexo CLI」安装后重试。', needInstall: true };
    }
    return a.preview.start();
  });
  handle('preview:stop', () => a.preview.stop());
  handle('preview:status', () => ({ ok: true, status: a.preview.getStatus() }));
  handle('preview:openBrowser', (url) => {
    const u = String(url || '');
    if (!u) return { ok: false, error: '未提供预览地址' };
    shell.openExternal(u);
    return { ok: true };
  });

  handle('backup:exportJson', async (p) => {
    const f = (p && p.path) ? p.path : await pickSave('hexo-backup.json', ['json']);
    if (!f) return { ok: false, cancelled: true };
    return { ok: true, result: a.backup.exportToJson(f) };
  });
  handle('backup:exportBak', async (p) => {
    const f = (p && p.path) ? p.path : await pickSave('hexo-backup.bak', ['bak']);
    if (!f) return { ok: false, cancelled: true };
    return { ok: true, result: a.backup.exportToBak(f) };
  });
  handle('backup:restore', async (p) => {
    const f = (p && p.path) ? p.path : await pickOpen([{ name: '备份文件', extensions: ['bak', 'json'] }]);
    if (!f) return { ok: false, cancelled: true };
    const confirmed = await dialog.showMessageBox(win, {
      type: 'warning', title: '恢复确认',
      message: '恢复将覆盖当前所有数据，确定继续吗？',
      buttons: ['取消', '确认恢复'], defaultId: 1, cancelId: 0
    });
    if (confirmed.response !== 1) return { ok: false, cancelled: true };
    return { ok: true, result: a.backup.restore(f) };
  });

  handle('env:detect', (runner) => {
    const env = a.env.detectEnvironment(runner);
    return { ok: true, env: env, guide: a.env.buildGuide(env) };
  });
  // 自定义页面管理
  handle('pages:list', () => a.pages.listPages());
  handle('pages:create', (input) => a.pages.createPage(input || {}));
  handle('pages:delete', (fileName) => a.pages.deletePage(fileName || ''));
  handle('media:list', () => ({ ok: true, items: a.media.list() }));
  handle('media:get', (id) => ({ ok: true, item: a.media.get(Number(id)) }));
  handle('media:add', (input) => { try { return { ok: true, item: a.media.add(input || {}) }; } catch(e) { return { ok: false, error: (e && e.message) || '上传失败' }; } });
  handle('media:delete', (id) => { try { return { ok: true, deleted: a.media.del(Number(id)) }; } catch(e) { return { ok: false, error: (e && e.message) || '删除失败' }; } });
  handle('notices:list', () => ({ ok: true, items: a.notices.list() }));
  handle('notices:get', (id) => ({ ok: true, item: a.notices.get(Number(id)) }));
  handle('notices:add', (input) => { try { return { ok: true, item: a.notices.add(input || {}) }; } catch(e) { return { ok: false, error: (e && e.message) || '添加失败' }; } });
  handle('notices:update', (id, input) => { try { return { ok: true, item: a.notices.update(Number(id), input || {}) }; } catch(e) { return { ok: false, error: (e && e.message) || '更新失败' }; } });
  handle('notices:delete', (id) => { try { return { ok: true, deleted: a.notices.del(Number(id)) }; } catch(e) { return { ok: false, error: (e && e.message) || '删除失败' }; } });
  handle('markdown:render', (md) => ({ ok: true, html: require('../core/markdown').renderMarkdown(md) }));

  // ---- Market: Hexo theme/plugin marketplace via npm registry ----
  handle('market:searchThemes', (query, size) => a.market.searchThemes(String(query || ''), Number(size) || 20));
  handle('market:searchPlugins', (query, category, size) => a.market.searchPlugins(String(query || ''), String(category || ''), Number(size) || 20));
  handle('market:getPackage', (name) => a.market.getPackageDetails(String(name || '')));
  handle('market:downloadPackage', (name, version, destDir) => a.market.downloadPackage(String(name || ''), String(version || ''), String(destDir || '')));
  handle('market:installTheme', (name, version) => a.market.installTheme(String(name || ''), String(version || ''), blogPathOf()));
  handle('market:installPlugin', (name, version) => a.market.installPlugin(String(name || ''), String(version || ''), blogPathOf()));
  handle('market:fetchStars', (names) => a.market.fetchGitHubStars(Array.isArray(names) ? names : []));
  handle('market:getCachedStars', () => ({ ok: true, stars: a.market.getCachedStars() }));
  handle('market:getRegistry', () => ({ ok: true, registry: a.market.getRegistryUrl() }));
  handle('market:setRegistry', (url) => {
    const u = String(url || '').trim();
    if (!u) return { ok: false, error: '不能为空' };
    a.market.setRegistryUrl(u);
    return { ok: true, registry: u };
  });
  // 在独立窗口中打开 Markdown 预览
  handle('preview:openWindow', (md, title) => {
    const html = require('../core/markdown').renderMarkdown(md || '');
    if (previewWin) {
      previewWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + esc(title) + '</title>'
        + '<style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1e3a5f;background:#fff;font-size:15px;line-height:1.8}.'
        + 'wrap{max-width:800px;margin:0 auto;padding:40px 32px}h1{font-size:2em;font-weight:800;margin-bottom:.3em;border-bottom:2px solid #e0eaff;padding-bottom:.3em}h2{font-size:1.5em;font-weight:700;margin:1.2em 0 .5em;border-bottom:1px solid #e0eaff;padding-bottom:.2em}h3{font-size:1.2em;font-weight:700;margin:1em 0 .4em}p{margin:.8em 0}ul,ol{padding-left:1.6em;margin:.6em 0}li{margin:.3em 0}blockquote{border-left:3px solid #2563eb;margin:1em 0;padding:.5em 1em;color:#5a7fa8;background:rgba(37,99,235,.05);border-radius:0 8px 8px 0}pre{background:#f5f9ff;border:1px solid #e0eaff;padding:14px;border-radius:10px;overflow-x:auto;margin:.8em 0}code{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:.88em;background:#f5f9ff;border:1px solid #e0eaff;border-radius:5px;padding:2px 6px}pre code{background:none;border:none;padding:0}a{color:#2563eb;text-decoration:none;border-bottom:1px dashed #2563eb}a:hover{border-bottom-style:solid}img{max-width:100%;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1)}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #e0eaff;padding:8px 12px;text-align:left}th{background:#f5f9ff;font-weight:600}hr{border:none;border-top:2px solid #e0eaff;margin:1.5em 0}.empty{color:#5a7fa8;font-style:italic;text-align:center;padding:3em}</style>'
        + '</head><body><div class="wrap">' + html + '</div></body></html>'
      ));
    } else {
      previewWin = new BrowserWindow({
        width: 900, height: 700, minWidth: 480, minHeight: 400,
        title: title || 'Markdown 预览', backgroundColor: '#ffffff',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      previewWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>' + esc(title) + '</title>'
        + '<style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#1e3a5f;background:#fff;font-size:15px;line-height:1.8}.'
        + 'wrap{max-width:800px;margin:0 auto;padding:40px 32px}h1{font-size:2em;font-weight:800;margin-bottom:.3em;border-bottom:2px solid #e0eaff;padding-bottom:.3em}h2{font-size:1.5em;font-weight:700;margin:1.2em 0 .5em;border-bottom:1px solid #e0eaff;padding-bottom:.2em}h3{font-size:1.2em;font-weight:700;margin:1em 0 .4em}p{margin:.8em 0}ul,ol{padding-left:1.6em;margin:.6em 0}li{margin:.3em 0}blockquote{border-left:3px solid #2563eb;margin:1em 0;padding:.5em 1em;color:#5a7fa8;background:rgba(37,99,235,.05);border-radius:0 8px 8px 0}pre{background:#f5f9ff;border:1px solid #e0eaff;padding:14px;border-radius:10px;overflow-x:auto;margin:.8em 0}code{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-size:.88em;background:#f5f9ff;border:1px solid #e0eaff;border-radius:5px;padding:2px 6px}pre code{background:none;border:none;padding:0}a{color:#2563eb;text-decoration:none;border-bottom:1px dashed #2563eb}a:hover{border-bottom-style:solid}img{max-width:100%;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1)}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #e0eaff;padding:8px 12px;text-align:left}th{background:#f5f9ff;font-weight:600}hr{border:none;border-top:2px solid #e0eaff;margin:1.5em 0}.empty{color:#5a7fa8;font-style:italic;text-align:center;padding:3em}</style>'
        + '</head><body><div class="wrap">' + html + '</div></body></html>'
      ));
      previewWin.on('closed', () => { previewWin = null; });
    }
    return { ok: true };
  });

  // 启动提醒：返回 使用手册.md 全文，供渲染器内嵌渲染展示（安装目录根下）
  handle('notice:manual', () => {
    try {
      const p = path.join(app.getAppPath(), '使用手册.md');
      const text = fs.readFileSync(p, 'utf8');
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: (e && e.code === 'ENOENT') ? '未找到使用手册文件' : ((e && e.message) ? e.message : String(e)) };
    }
  });

  // 导入 .txt / .md 文件到编辑器：选择文件、读取内容，解析 front-matter 回填标题/正文
  handle('files:openImage', async () => {
    if (!win) return { ok: false, error: '窗口未就绪' };
    const filters = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }];
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    if (res.canceled) return { ok: false, cancelled: true };
    const fpath = res.filePaths[0];
    let dataUrl = '';
    try {
      const buf = fs.readFileSync(fpath);
      const ext = path.extname(fpath).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[ext] || 'image/png';
      dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
    } catch (_) {}
    return { ok: true, path: fpath, dataUrl };
  });
  handle('files:openText', async () => {
    if (!win) return { ok: false, error: '窗口未就绪' };
    const filters = [{ name: '文本与 Markdown', extensions: ['txt', 'md', 'markdown'] }];
    const f = await pickOpen(filters);
    if (!f) return { ok: false, cancelled: true };
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); }
    catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
    const base = path.basename(f);
    const parsed = parseFrontMatter(raw);
    const title = (parsed && parsed.data && parsed.data.title) || base.replace(/\.(txt|md|markdown)$/i, '');
    const body = parsed ? parsed.body : raw;
    const tags = (parsed && parsed.data && Array.isArray(parsed.data.tags)) ? parsed.data.tags.join(', ') : '';
    const cats = (parsed && parsed.data && Array.isArray(parsed.data.categories)) ? parsed.data.categories.join(', ') : '';
    return { ok: true, file: base, title, tags, categories: cats, content: body };
  });
}


async function pickSave(defaultName, extensions) {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName, filters: [{ name: '文件', extensions }]
  });
  return res.canceled ? null : res.filePath;
}
async function pickOpen(filters) {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return res.canceled ? null : res.filePaths[0];
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);     // 移除默认菜单栏（文件/编辑/视图/窗口）
  // 注册自定义协议用于 OAuth 回调（仅 Windows，macOS 用 open-url 事件）
  if (process.platform === 'win32') {
    try { app.setAsDefaultProtocolClient('hexostudio'); } catch (_) {}
  }
  backend = createApp({ dbPath: dbPath() });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // macOS: 打开 URL 事件（如从 Safari 点击 hexostudio:// 链接）
  app.on('open-url', (_event, url) => { handleOAuthCallback(url); });
  // Windows/Linux: 二次启动时收到 argv（其他实例已锁定 single-instance）
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(a => String(a).startsWith('hexostudio://'));
    if (url) handleOAuthCallback(url);
  });
});

app.on('window-all-closed', () => {
  shutdownBackend();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdownBackend);
