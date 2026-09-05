'use strict';

// ===== utilities =====
const $ = (s, root) => (root || document).querySelector(s);
const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
let state = { route: 'dashboard', search: '', filter: 'all', editing: null, guide: null, user: null, authMode: 'login' };

function esc(s) {
  const E = function (c) { return String.fromCharCode(38) + '#' + c + ';'; };
  return String(s == null ? '' : s)
    .replace(/&/g, E(38)).replace(/</g, E(60)).replace(/>/g, E(62))
    .replace(/"/g, E(34)).replace(/'/g, E(39));
}
function toast(msg, type) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast ' + (type || '');
  t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2400);
}
function confirmModal(text, okLabel, danger) {
  return new Promise(resolve => {
    const m = $('#modal'); $('#modal-text').textContent = text;
    const ok = $('#modal-ok'); ok.textContent = okLabel || '确认'; ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    const cancel = $('#modal-cancel');
    const close = (v) => { m.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => close(true);
    cancel.onclick = () => close(false);
    m.classList.remove('hidden');
  });
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ===== 启动提醒 & 使用手册 =====
function showNotice() {
  api.invoke('settings:get', 'notice_dismiss_v1', '').then(r => {
    if (r && r.ok && r.value === '1') return;
    const m = $('#notice-modal'); if (!m) return;
    m.classList.remove('hidden');
    const dismiss = () => {
      const cb = $('#notice-dont-show');
      if (cb && cb.checked) api.invoke('settings:set', 'notice_dismiss_v1', '1').catch(() => {});
      m.classList.add('hidden');
    };
    const ok = $('#notice-ok'); if (ok) ok.onclick = dismiss;
    const man = $('#notice-manual'); if (man) man.onclick = openManual;
    const copy = $('#notice-copy'); if (copy) copy.onclick = copyNoticeMail;
  }).catch(() => {});
}
function copyNoticeMail() {
  const addr = '3073922647@qq.com';
  const done = () => toast('已复制邮箱：' + addr, 'ok');
  try {
    const ta = document.createElement('textarea'); ta.value = addr; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
  } catch (e) { done(); }
}
function openManual() {
  const m = $('#manual-modal'); if (!m) return;
  m.classList.remove('hidden');
  const body = $('#manual-body'); if (body) body.innerHTML = '加载中…';
  api.invoke('notice:manual').then(r => {
    if (!r || !r.ok) { if (body) body.innerHTML = '<div class="empty">' + esc((r && r.error) || '未找到使用手册') + '</div>'; return; }
    api.invoke('markdown:render', r.text).then(h => {
      if (body) body.innerHTML = (h && h.ok) ? h.html : '<pre>' + esc(r.text) + '</pre>';
    }).catch(() => { if (body) body.innerHTML = '<pre>' + esc(r.text) + '</pre>'; });
  }).catch(() => { if (body) body.innerHTML = '<div class="empty">无法加载使用手册</div>'; });
}

// ===== 环境门禁 =====
// Cache theme and background to avoid repeated IPC calls on navigation
let _themeCache = null;
let _cssCache = null;
let _bgCache = null;
// Cache computed style values for color pickers (avoids repeated getComputedStyle calls)
let _computedStyleCache = null;
function getComputedVal(key) {
  if (!_computedStyleCache) {
    try {
      const s = getComputedStyle(document.documentElement);
      _computedStyleCache = {};
      for (const k of ['--accent','--accent-2','--bg','--panel','--panel-2','--text','--muted','--border']) {
        _computedStyleCache[k] = s.getPropertyValue(k).trim();
      }
    } catch { _computedStyleCache = {}; }
  }
  return _computedStyleCache[key] || '';
}

function applyTheme() {
  // Theme: set immediately if cached, otherwise async
  if (_themeCache !== null) {
    document.documentElement.setAttribute('data-theme', _themeCache);
  } else {
    api.invoke('settings:getTheme').then(r => {
      const t = (r && r.ok && r.theme) ? r.theme : 'light';
      _themeCache = t;
      document.documentElement.setAttribute('data-theme', t);
    }).catch(() => {});
  }
  applyCustomColors();
  applyBackground();
}
async function applyCustomColors() {
  if (_cssCache === null) {
    const r = await api.invoke('settings:getCustomCss').catch(() => ({ ok: false, css: {} }));
    _cssCache = (r && r.ok && r.css) ? r.css : null;
  }
  if (!_cssCache) return;
  const el = document.documentElement;
  for (const [key, value] of Object.entries(_cssCache)) {
    el.style.setProperty(key, value);
  }
}
async function applyBackground() {
  if (_bgCache === null) {
    const r = await api.invoke('settings:getBackground').catch(() => ({ ok: false, bg: { url: '', opacity: 0.4, blur: 0 } }));
    _bgCache = (r && r.ok && r.bg) ? r.bg : null;
  }
  if (!_bgCache) return;
  const bg = _bgCache;
  // Create a dedicated background layer so blur only affects the image, not the UI
  let bgLayer = document.getElementById('__bg-layer');
  if (bg.url) {
    if (!bgLayer) {
      bgLayer = document.createElement('div');
      bgLayer.id = '__bg-layer';
      bgLayer.style.cssText = 'position:fixed;inset:0;z-index:-2;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;';
      document.body.appendChild(bgLayer);
    }
    bgLayer.style.backgroundImage = 'url(' + bg.url + ')';
    bgLayer.style.filter = bg.blur > 0 ? 'blur(' + bg.blur + 'px)' : 'none';
    // Opacity overlay sits between bg-layer and content
    let overlay = document.getElementById('__bg-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__bg-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
      document.body.appendChild(overlay);
    }
    overlay.style.background = 'rgba(255,255,255,' + (1 - bg.opacity) + ')';
    // Mark body as having a background so CSS can apply glass effects
    document.body.setAttribute('data-bg', '1');
  } else {
    document.body.removeAttribute('data-bg');
    if (bgLayer) { bgLayer.remove(); bgLayer = null; }
    const overlay = document.getElementById('__bg-overlay');
    if (overlay) overlay.remove();
  }
}
function openEnvGate() {
  const g = $('#env-gate'); if (!g) { enterApp(); return; }
  g.classList.remove('hidden');
  const user = state.user && state.user.username ? ' · ' + esc(state.user.username) : '';
  const eu = $('#env-gate-user'); if (eu) eu.innerHTML = '欢迎' + user;
  const body = $('#env-gate-body');
  const enter = $('#env-gate-enter');
  if (enter) { enter.disabled = true; enter.onclick = enterApp; }
  const recheck = $('#env-gate-recheck'); if (recheck) recheck.onclick = () => detectEnv(body, enter);
  detectEnv(body, enter);
}
function renderGuideHTML(guide, env) {
  const rows = (guide && guide.steps ? guide.steps : []).map(s => {
    const status = s.installed
      ? '<span class="badge ok">✓ 已安装</span><span class="env-ver">' + esc(s.version || '') + '</span>'
      : '<span class="badge danger">未安装</span>';
    const inst = s.installed ? '' : (s.key === 'hexo'
      ? '<button class="btn primary env-install-btn" data-env="' + s.key + '">一键安装 Hexo CLI</button>'
      : '<div class="env-install-row">' + esc(s.instruction) + '</div>');
    return '<div class="env-row">'
      + '<div class="gate-row"><strong>' + esc(s.label) + '</strong> ' + status + '</div>'
      + inst + '</div>';
  }).join('');
  // 进软件的硬门槛只需 Node.js；Hexo/Git 缺失只是影响预览/部署，不再卡门禁。
  const nodeReady = env && env.node && env.node.installed;
  const missing2 = (guide && guide.missing ? guide.missing : []).length > 0;
  let ready;
  if (!nodeReady) {
    ready = '<div class="env-gate-warn">缺少 Node.js，需先安装 Node 才能运行本软件。</div>';
  } else if (missing2) {
    ready = '<div class="env-gate-pass">✓ Node.js 已就绪，可进入软件。</div>'
      + '<div class="env-gate-warn">提示：Hexo / Git 缺失会令本地预览、部署、扫描导入不可用，其余功能正常。</div>';
  } else {
    ready = '<div class="env-gate-pass">✓ 环境就绪，可管理博客。</div>';
  }
  return rows + ready;
}
function detectEnv(body, enter) {
  if (body) body.innerHTML = '<div class="env-gate-loading">正在检测 Node.js / Hexo CLI / Git，请稍候…</div>';
  api.invoke('env:detect').then(r => {
    if (!r || !r.ok) { if (body) body.innerHTML = '<div class="empty">检测失败</div>'; return; }
    const nodeReady = r && r.env && r.env.node && r.env.node.installed;
    if (enter) enter.disabled = !nodeReady;
    if (body) body.innerHTML = renderGuideHTML(r.guide, r.env);
    $$('.env-install-btn').forEach(b => b.onclick = () => installHexo(b, body, enter));
  }).catch(() => { if (body) body.innerHTML = '<div class="empty">检测失败</div>'; });
}function installHexo(btn, body, enter) {
  btn.disabled = true; btn.textContent = '正在安装…';
  toast('正在安装 Hexo CLI，请耐心等待…');
  api.invoke('env:installHexo').then(r => {
    if (!r || !r.ok) { btn.textContent = '一键安装 Hexo CLI'; btn.disabled = false; return toast((r && r.error) || '安装失败', 'danger'); }
    toast('已安装 Hexo CLI ' + (r.version || ''), 'ok');
    detectEnv(body, enter);
  }).catch(() => { btn.disabled = false; btn.textContent = '一键安装 Hexo CLI'; });
}
function enterApp() {
  const g = $('#env-gate'); if (g) g.classList.add('hidden');
  const app = $('#app-view'); if (app) app.classList.remove('hidden');
  renderUserBox();
  navigate('dashboard');
}

// ===== navigation =====
function navigate(route) {
  state.route = route || 'dashboard';
  const el = $('#content');
  if (el) el.innerHTML = '';
  $$('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.route === state.route);
  });
  const map = {
    dashboard: renderDashboard, posts: renderPosts, tags: renderTagsCategories,
    preview: renderPreview, themes: renderThemes, pages: renderPages, deploy: renderDeploy, settings: renderSettings, profile: renderProfile, media: renderMedia, notices: renderNotices, market: renderMarket
  };
  (map[state.route] || renderDashboard)().catch(err => {
    console.error('[navigate] render error for', state.route, err);
    if (el) el.innerHTML = '<div class="empty">页面加载失败</div>';
  });
}
function renderUserBox() {
  api.invoke('auth:currentUser').then(r => {
    if (r && r.ok && r.user) {
      state.user = r.user;
      const u = $('#current-username'); if (u) u.textContent = r.user.username || '—';
    } else {
      const u = $('#current-username'); if (u) u.textContent = '—';
    }
  }).catch(() => {
    const u = $('#current-username'); if (u) u.textContent = '—';
  });
}
// ===== boot =====
function boot() {
  applyTheme();
  $$('.nav-item').forEach(b => b.onclick = () => navigate(b.dataset.route));
  wireAuth();
  wireOAuth();
  const logout = $('#logout-btn'); if (logout) logout.onclick = doLogout;
  api.invoke('settings:setTheme', '').catch(() => {});
  showManualClose();
  showNotice();
  // notified channels should be ready; try remembered login
  api.invoke('auth:tryRememberedLogin').then(r => {
    if (r && r.ok && r.user) { state.user = r.user; openEnvGate(); }
    else { showAuth(); }
  }).catch(() => showAuth());
  // remember user password checkbox default checked
  const rem = $('#auth-remember'); if (rem) rem.checked = true;
}
function showManualClose() { const c = $('#manual-close'); if (c) c.onclick = () => $('#manual-modal').classList.add('hidden'); }

// ===== auth =====
function showAuth() {
  $('#auth-view').classList.remove('hidden');
  const app = $('#app-view'); if (app) app.classList.add('hidden');
  const gate = $('#env-gate'); if (gate) gate.classList.add('hidden');
  switchAuthMode('login');
}
function switchAuthMode(mode) {
  state.authMode = mode || 'login';
  const isReg = state.authMode === 'register';
  const cf = $('#auth-confirm-field'); if (cf) cf.classList.toggle('hidden', !isReg);
  const hint = $('#auth-register-hint'); if (hint) hint.classList.toggle('hidden', !isReg);
  const tLogin = $('#auth-tab-login'); const tReg = $('#auth-tab-register');
  if (tLogin) tLogin.classList.toggle('active', !isReg);
  if (tReg) tReg.classList.toggle('active', isReg);
  const submit = $('#auth-submit'); if (submit) { submit.textContent = isReg ? '注册' : '登录'; }
}
function wireAuth() {
  const f = $('#auth-form'); if (f) f.onsubmit = submitAuth;
  const tl = $('#auth-tab-login'); if (tl) tl.onclick = () => switchAuthMode('login');
  const tr = $('#auth-tab-register'); if (tr) tr.onclick = () => switchAuthMode('register');
}
function submitAuth(e) {
  e.preventDefault();
  const u = $('#auth-username').value.trim();
  const p = $('#auth-password').value;
  const c = $('#auth-confirm').value;
  const errEl = $('#auth-error'); if (errEl) errEl.classList.add('hidden');
  if (!u || !p) { showAuthError('请输入用户名和密码'); return; }
  if (state.authMode === 'register' && p !== c) { showAuthError('两次输入的密码不一致'); return; }
  const action = state.authMode === 'register' ? 'auth:register' : 'auth:login';
  const payload = state.authMode === 'register' ? { username: u, password: p, confirm: c } : { username: u, password: p };
  const sub = $('#auth-submit'); if (sub) sub.disabled = true;
  const remember = $('#auth-remember') && $('#auth-remember').checked && state.authMode === 'login';
  api.invoke(action, payload).then(r => {
    if (sub) sub.disabled = false;
    if (!r || !r.ok || !r.user) { showAuthError((r && r.error) || '登录失败'); return; }
    state.user = r.user;
    if (remember) api.invoke('auth:rememberLogin', { username: u, password: p }).catch(() => {});
    $('#auth-password').value = '';
    $('#auth-confirm').value = '';
    $('#auth-view').classList.add('hidden');
    openEnvGate();
  }).catch(err => {
    if (sub) sub.disabled = false;
    showAuthError((err && err.message) || '网络错误');
  });
}
function showAuthError(msg) {
  const e = $('#auth-error'); if (!e) { toast(msg, 'danger'); return; }
  e.textContent = msg; e.classList.remove('hidden');
}
function doLogout() {
  api.invoke('auth:clearRemembered').catch(() => {});
  api.invoke('auth:logout').then(() => showAuth()).catch(() => showAuth());
}

// ===== OAuth =====
const OAUTH_PROVIDERS = ['github', 'gitee'];
const OAUTH_LABELS = { github: 'GitHub', gitee: 'Gitee' };
const COLOR_PRESETS = [
  { key: '--accent', label: '主色 accent', group: '主色' },
  { key: '--accent-2', label: '深色 accent', group: '主色' },
  { key: '--bg', label: '背景 bg', group: '底色' },
  { key: '--panel', label: '面板 panel', group: '底色' },
  { key: '--panel-2', label: '次面板 panel-2', group: '底色' },
  { key: '--text', label: '文字 text', group: '文字' },
  { key: '--muted', label: '次要文字 muted', group: '文字' },
  { key: '--border', label: '边框 border', group: '边框' },
];

async function loadOAuthProviders() {
  const divider = $('#auth-oauth-divider');
  const buttons = $('#auth-oauth-buttons');
  if (!divider || !buttons) return;
  // Check if any provider has a client_id configured
  let hasConfigured = false;
  for (const p of OAUTH_PROVIDERS) {
    const r = await api.invoke('auth:isLinked', p).catch(() => ({ linked: false }));
    // We'll show the buttons regardless; config errors are handled at click time
  }
  // Show OAuth buttons
  divider.classList.remove('hidden');
  buttons.classList.remove('hidden');
}

function wireOAuth() {
  for (const provider of OAUTH_PROVIDERS) {
    const btn = $(`#auth-oauth-${provider}`);
    if (!btn) continue;
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '正在跳转...';
      try {
        const r = await api.invoke('auth:oAuthStart', provider);
        if (!r.ok) {
          showAuthError(r.error || 'OAuth 启动失败');
          btn.disabled = false;
          btn.textContent = OAUTH_LABELS[provider] || provider;
          return;
        }
        // Wait for callback via IPC
        await new Promise((resolve, reject) => {
          let settled = false;
          const settle = (val) => { if (settled) return; settled = true; };
          const timer = setTimeout(() => {
            settle();
            reject(new Error('OAuth 授权超时，请重试'));
          }, 300000); // 5 minutes
          api.on('oauth:callback', async (data) => {
            clearTimeout(timer);
            settle();
            resolve(data);
          });
          api.on('oauth:error', (err) => {
            clearTimeout(timer);
            settle();
            reject(new Error(err || '授权被取消'));
          });
        });
        // Exchange code for token and login
        const exchangeR = await api.invoke('auth:exchangeOAuthCode', { provider, code: data.code });
        if (!exchangeR.ok) {
          showAuthError(exchangeR.error || '授权码兑换失败');
          btn.disabled = false;
          btn.textContent = OAUTH_LABELS[provider] || provider;
          return;
        }
        state.user = exchangeR.user;
        const u = $('#current-username'); if (u) u.textContent = exchangeR.user.username || '—';
        $('#auth-view').classList.add('hidden');
        openEnvGate();
      } catch (err) {
        showAuthError(err.message || 'OAuth 失败');
      } finally {
        btn.disabled = false;
        btn.textContent = OAUTH_LABELS[provider] || provider;
      }
    };
  }
}

// ===== dashboard =====
async function renderDashboard() {
  const content = $('#content');
  if (!content) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  // Build calendar HTML
  const weekdays = ['日','一','二','三','四','五','六'];
  let calHtml = weekdays.map(d => '<div class="cal-weekday">' + d + '</div>').join('');
  for (let e = 0; e < firstDay; e++) calHtml += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    calHtml += '<div class="cal-day' + (d === today ? ' today' : '') + '">' + d + '</div>';
  }
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let f = firstDay + daysInMonth; f < totalCells; f++) calHtml += '<div class="cal-day empty"></div>';

  content.innerHTML = '<div class="left-col">'
    + '<div class="card"><div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>项目跟踪</div><div class="project-grid" id="dash-project-grid">加载中…</div></div>'
    + '<div class="card"><div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>日历</div>'
    + '<div class="cal-header"><div class="cal-nav"><button class="cal-nav-btn" id="cal-prev"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button><span id="cal-month-label">' + year + '年' + monthNames[month] + '</span><button class="cal-nav-btn" id="cal-next"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button></div></div>'
    + '<div class="cal-grid" id="dash-cal-grid">' + calHtml + '</div></div>'
    + '</div>'
    + '<div class="right-col">'
    + '<div class="card"><div class="card-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>已有文章</div><div id="dash-recent-posts">加载中…</div></div>'
    + '</div>';

  const [st, posts] = await Promise.all([
    api.invoke('dashboard:stats'),
    api.invoke('posts:list')
  ]);

  // project tracking cards
  const pg = $('#dash-project-grid');
  if (pg && st && st.ok) {
    const s = st.stats;
    pg.innerHTML = [
      { cls: 'c1', num: s.draft || 0, label: '草稿' },
      { cls: 'c2', num: s.published || 0, label: '已发布' },
      { cls: 'c3', num: s.scheduled || 0, label: '待审核' },
      { cls: 'c4', num: s.published + s.draft + s.scheduled || 0, label: '总文章' }
    ].map(c => '<div class="project-card ' + c.cls + '">'
      + '<div class="project-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></div>'
      + '<div class="project-num">' + c.num + '</div>'
      + '<div class="project-label">' + c.label + '</div></div>').join('');
  }

  // recent posts
  const rpEl = $('#dash-recent-posts');
  if (rpEl) {
    const list = (posts && posts.posts) ? posts.posts.slice(0, 8) : [];
    if (!list.length) {
      rpEl.innerHTML = '<div class="empty">暂无文章，去「文章管理」新建第一篇文章吧。</div>';
    } else {
      const statusName = { published: '已发布', draft: '草稿', scheduled: '定时' };
      rpEl.innerHTML = list.map(p => '<div class="msg-item" data-po="' + p.id + '">'
        + '<div class="msg-body">'
        + '<div class="msg-top"><span class="msg-name">' + esc(p.title) + '</span><span class="msg-time">' + fmtTime(p.date) + '</span></div>'
        + '<div style="display:flex;align-items:center;gap:8px">'
        + '<span class="badge ' + (p.status === 'published' ? 'ok' : (p.status === 'draft' ? 'warn' : '')) + '">' + esc(statusName[p.status] || p.status) + '</span>'
        + '<span class="chip">' + esc((p.tags || []).slice(0, 2).join(', ')) + '</span>'
        + '</div></div></div>').join('');
    }
  }
}

// ===== posts list + editor =====
async function renderPosts() {
  $('#content').innerHTML = '<h1 class="page-title">文章管理</h1><div class="page-wrap">'
    + '<div class="topbar-row"><input id="po-search" placeholder="搜索标题…" value="' + esc(state.search) + '"/>'
    + '<select id="po-filter"><option value="all">全部</option><option value="published">已发布</option><option value="draft">草稿</option><option value="scheduled">定时</option></select>'
    + '<button class="btn primary" id="po-new">＋ 新建文章</button>'
    + '<button class="btn" id="po-scan" title="扫描博客 source/_posts/*.md 一键导入">📥 从博客导入</button>'
    + '<button class="btn" id="po-import" title="选择本地 .txt/.md 文件新建一篇文章">📄 从文件导入</button></div>'
    + '<div id="po-list">加载中…</div></div>';
  const sf = $('#po-filter'); if (sf) { sf.value = state.filter; sf.onchange = () => { state.filter = sf.value; loadPosts(); }; }
  const si = $('#po-search'); if (si) si.oninput = () => { state.search = si.value.trim(); clearTimeout(si._t); si._t = setTimeout(loadPosts, 250); };
  $('#po-new').onclick = () => openEditor(null);
  $('#po-scan').onclick = scanBlog;
  $('#po-import').onclick = importFromFile;
  loadPosts();
}
async function loadPosts() {
  const node = $('#po-list'); if (!node) return;
  let r;
  if (state.search) r = await api.invoke('posts:search', state.search);
  else if (state.filter !== 'all') r = await api.invoke('posts:filterByStatus', state.filter);
  else r = await api.invoke('posts:list');
  if (!r || !r.ok) { node.innerHTML = '<div class="empty">' + esc((r && r.error) || '读取失败') + '</div>'; return; }
  if (!r.posts || !r.posts.length) { node.innerHTML = '<div class="empty">还没有文章，点「＋ 新建文章」或「📥 从博客导入」开始。</div>'; return; }
  const statusName = { published: '已发布', draft: '草稿', scheduled: '定时' };
  node.innerHTML = '<table><thead><tr><th>标题</th><th>状态</th><th>日期</th><th>标签</th><th>操作</th></tr></thead><tbody>'
    + r.posts.map(p => '<tr>'
      + '<td><strong>' + esc(p.title) + '</strong><div class="muted-row">' + esc(p.source_file || '') + '</div></td>'
      + '<td><span class="badge ' + (p.status === 'published' ? 'ok' : (p.status === 'draft' ? 'warn' : '')) + '">' + esc(statusName[p.status] || p.status) + '</span></td>'
      + '<td>' + fmtTime(p.date) + '</td>'
      + '<td>' + esc((p.tags || []).join(', ')) + '</td>'      + '<td class="row-actions"><button class="btn" data-po="' + p.id + '" data-act="edit">编辑</button><button class="btn primary" data-po="' + p.id + '" data-act="publish"' + (p.status === 'published' ? ' disabled title="已发布"' : '') + '>发布</button><button class="btn danger" data-po="' + p.id + '" data-act="del">删除</button></td>'
      + '</tr>').join('') + '</tbody></table>';
  $$('#po-list [data-po]').forEach(b => b.onclick = async () => {
    const id = b.dataset.po;
    if (b.dataset.act === 'del') {
      const ok = await confirmModal('确认删除该文章吗？（将软删除软件库记录并删除博客 source 源文件；预览若在运行需重启以更新）', '删除', true);
      if (!ok) return;
      const r2 = await api.invoke('posts:delete', id);
      if (!r2 || !r2.ok) return toast((r2 && r2.error) || '删除失败', 'danger');
      toast('已删除' + ((r2 && r2.sync && r2.sync.skipped) ? '（无关联博客文件可清理）' : '，已同步删除博客源文件') + '；预览在运行请重启以更新', 'ok'); loadPosts();    } else if (b.dataset.act === 'publish') {
      const g = await api.invoke('posts:get', id);
      if (!g || !g.ok) return toast((g && g.error) || '读取失败', 'danger');
      const post = g.post;
      toast('正在发布…');
      const r2 = await api.invoke('posts:update', id, Object.assign({}, post, { status: 'published' }));
      if (!r2 || !r2.ok) return toast((r2 && r2.error) || '发布失败', 'danger');
      toast('已发布' + (r2.sync && r2.sync.skipped ? '' : '，已同步到博客'), 'ok');
      loadPosts();
    } else {
      const r2 = await api.invoke('posts:get', id);
      if (!r2 || !r2.ok) return toast((r2 && r2.error) || '读取失败', 'danger');
      openEditor(r2.post);
    }
  });
}
// 扫描博客 source/_posts，导入到软件库；展示「导入结果」对话框（新进 + 跳过）
async function scanBlog() {
  toast('正在扫描博客文章…');
  const r = await api.invoke('scanner:scan');
  if (!r || !r.ok) return toast((r && r.error) || '扫描失败', 'danger');
  const imported = r.imported || (r.importedPosts ? r.importedPosts.length : 0);
  const skipped = Array.isArray(r.skipped) ? r.skipped : [];
  openScanResult(imported, skipped, r.importedPosts || []);
  if (imported > 0) loadPosts();
}
function openScanResult(imported, skipped, posts) {
  const rows = (posts || []).slice(0, 50).map(p => '<li>' + esc(p.title || '') + '</li>').join('');
  const skipRows = skipped.slice(0, 50).map(s => '<li><span class="badge warn" style="margin-right:6px">跳过</span>' + esc(s.title || s.file || '') + ' — ' + esc(s.reason || '') + '</li>').join('');
  const body = '<div class="muted-row" style="margin-bottom:10px">导入 <b style="color:var(--ok)">' + imported + '</b> 篇' + (skipped.length ? '，跳过 <b style="color:var(--warn)">' + skipped.length + '</b> 篇' : '') + '。</div>'
    + (rows ? '<div style="margin:6px 0 4px;color:var(--muted-2);font-size:12.5px;font-weight:700;letter-spacing:.5px">新导入</div><ul style="margin:0 0 12px;padding-left:18px;line-height:1.7">' + rows + '</ul>' : '')
    + (skipRows ? '<div style="margin:6px 0 4px;color:var(--muted-2);font-size:12.5px;font-weight:700;letter-spacing:.5px">跳过</div><ul style="margin:0;padding-left:18px;line-height:1.7">' + skipRows + '</ul>' : '');
  // 用 #modal-text 容纳富文本（confirmModal 用 textContent 不能渲染富文本，这里自绘一个轻量结果框）
  const result = document.getElementById('scan-result-overlay');
  if (result) result.remove();
  const m = document.createElement('div');
  m.id = 'scan-result-overlay';
  m.className = 'modal';
  m.innerHTML = '<div class="modal-card" style="max-width:520px"><h3 style="margin:0 0 4px">📥 扫描导入结果</h3>' + body
    + '<div class="modal-actions"><button class="btn primary" id="scan-result-ok">知道了</button></div></div>';
  document.body.appendChild(m);
  $('#scan-result-ok').onclick = () => { m.remove(); };
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
}
function openEditor(post) {
  state.editing = post && post.id != null ? post.id : null;
  const isNew = !post;
  const p = post || { title: '', status: 'draft', tags: [], categories: [], content: '', date: new Date().toISOString() };
  const overlay = document.createElement('div');
  overlay.id = 'editor-modal-overlay-1'; overlay.className = 'editor-modal-overlay';
  overlay.innerHTML = '<div class="editor-modal-card">'
    + '<div class="editor-header">'
    + '<div class="eh-left"><input class="eh-title-input" id="ed-title" placeholder="文章标题" value="' + esc(p.title) + '"/></div>'
    + '<div class="eh-right">'
    + '<select class="eh-status badge-pill" id="ed-status" data-s="' + esc(p.status || 'draft') + '">'
    + '<option value="draft"' + (p.status === 'draft' ? ' selected' : '') + '>草稿</option>'
    + '<option value="published"' + (p.status === 'published' ? ' selected' : '') + '>已发布</option>'
    + '<option value="scheduled"' + (p.status === 'scheduled' ? ' selected' : '') + '>定时</option>'
    + '</select>'
    + '<button class="editor-close" id="ed-close" type="button">✕</button>'
    + '</div></div>'
    + '<div class="editor-meta">'
    + '<div class="field"><label>标签（逗号分隔）</label><input id="ed-tags" value="' + esc((p.tags || []).join(', ')) + '"/></div>'
    + '<div class="field"><label>分类（逗号分隔）</label><input id="ed-cats" value="' + esc((p.categories || []).join(', ')) + '"/></div>'
    + '</div>'
    + '<div class="editor-toolbar">'
    + '<span class="et-label">插入</span>'
    + '<button class="tool" data-tool="h1" title="一级标题"><span>H1</span></button>'
    + '<button class="tool" data-tool="h2" title="二级标题"><span>H2</span></button>'
    + '<button class="tool" data-tool="h3" title="三级标题"><span>H3</span></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="bold" title="加粗 (Ctrl+B)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg></button>'
    + '<button class="tool" data-tool="italic" title="斜体 (Ctrl+I)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></button>'
    + '<button class="tool" data-tool="code" title="行内代码 (Ctrl+K)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="quote" title="引用"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.47 3.84a.5.5 0 0 1 .71 0l.85 1.42a.5.5 0 0 1-.71.71L11 5l-.92.97a.5.5 0 1 1-.7-.71l.85-1.42a.5.5 0 0 1 .24-.2zm-4.5 8a.5.5 0 0 1 .71 0l.85 1.42a.5.5 0 0 1-.71.71L7 14l-.92.97a.5.5 0 1 1-.7-.71l.85-1.42a.5.5 0 0 1 .24-.2z"/></svg><span>引用</span></button>'
    + '<button class="tool" data-tool="ul" title="无序列表"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="18" r="1.5" fill="currentColor"/></svg></button>'
    + '<button class="tool" data-tool="ol" title="有序列表"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="3" y="8" font-size="7" fill="currentColor" stroke="none">1</text><text x="3" y="14" font-size="7" fill="currentColor" stroke="none">2</text><text x="3" y="20" font-size="7" fill="currentColor" stroke="none">3</text></svg></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="link" title="链接"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>'
    + '<button class="tool" data-tool="img" title="图片"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="hr" title="分割线"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/></svg></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="import" id="ed-import2" title="从本地导入"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>导入</span></button>'
    + '</div>'
    + '<div class="editor-pane editor-pane-single">'
    + '<div class="col write">'
    + '<div class="col-head"><span class="col-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Markdown</span><div style="display:flex;gap:6px"><button class="eh-empty-btn" id="ed-clear" type="button">清空</button><button class="eh-empty-btn" id="ed-open-preview" type="button" title="Ctrl+Shift+P 在独立窗口预览">↗ 预览窗口</button></div></div>'
    + '<div class="code-wrap">'
    + '<div class="gutter" id="ed-gutter"></div>'
    + '<textarea id="ed-content" placeholder="在此输入 Markdown 正文…" style="padding-left:60px">' + esc(p.content || '') + '</textarea>'
    + '<div class="active-line-rule" id="ed-active-line"></div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="editor-foot">'
    + '<div class="ef-stats"><span id="ed-words">字数 0</span><span id="ed-lines">行 1</span><span id="ed-source">' + (p.source_file ? '文件：' + esc(p.source_file) : '新文章') + '</span><span id="ed-autosave" class="autosave-status hidden"></span></div>'
    + '<div class="ef-actions"><button class="btn" id="ed-cancel">取消</button><button class="btn primary" id="ed-save">保存</button></div>'
    + '</div>'
    + '</div>';
  document.body.appendChild(overlay);
  const statusSel = $('#ed-status');
  if (statusSel) { statusSel.value = p.status; statusSel.dataset.s = p.status; statusSel.onchange = () => { statusSel.dataset.s = statusSel.value; }; }
  $('#ed-close').onclick = closeEditor;
  $('#ed-cancel').onclick = closeEditor;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditor(); });
  $$('.editor-toolbar .tool[data-tool]').forEach(b => { b.onclick = () => applyEditorTool(b.dataset.tool); });
  $('#ed-refresh').onclick = renderEditorPreview;
  const openWinBtn = $('#ed-open-preview');
  if (openWinBtn) {
    openWinBtn.onclick = async () => {
      const md = $('#ed-content') ? $('#ed-content').value : '';
      const title = $('#ed-title').value.trim() || '文章预览';
      await api.invoke('preview:openWindow', md, title);
    };
  }
  $('#ed-clear').onclick = () => {
    const ta = $('#ed-content');
    if (!ta || ta.value.trim() === '' || window.confirm('确定清空正文？')) { if (ta) ta.value = ''; afterEdEdit(); }
  };
  $('#ed-save').onclick = saveEditor;
  const imp = $('#ed-import2'); if (imp) imp.onclick = () => importIntoEditor();
  const ta = $('#ed-content');
  if (ta) {
    ta.addEventListener('input', afterEdEdit);
    ta.addEventListener('scroll', () => { syncGutterScroll(); updateActiveLineRule(); });
    ta.addEventListener('keyup', updateActiveLineRule);
    ta.addEventListener('click', updateActiveLineRule);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); applyEditorTool('tab'); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyEditorTool('bold'); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyEditorTool('italic'); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); applyEditorTool('code'); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveEditor(); }
    });
  }
  updateGutter(); updateActiveLineRule(); updateEditorStats(); renderEditorPreview();
  setTimeout(() => { if (ta) ta.focus(); }, 50);
}
function closeEditor() {
  const ov = $('#editor-modal-overlay-1'); if (ov) ov.remove();
  state.editing = null;
}
function editorPreviewTimer() { clearTimeout(editorPreviewTimer._t); editorPreviewTimer._t = setTimeout(renderEditorPreview, 380); }
function afterEdEdit() { updateGutter(); updateActiveLineRule(); updateEditorStats(); editorPreviewTimer(); }
function updateGutter() {
  const ta = $('#ed-content'); const g = $('#ed-gutter');
  if (!ta || !g) return;
  const cur = (ta.selectionStart >= 0) ? ta.value.substr(0, ta.selectionStart).split('\n').length : 1;
  const lines = ta.value.split('\n');
  let html = '';
  for (let i = 1; i <= lines.length; i++) html += '<span' + (i === cur ? ' class="cur"' : '') + '>' + i + '</span>';
  g.innerHTML = html;
}
function syncGutterScroll() {
  const ta = $('#ed-content'); const g = $('#ed-gutter');
  if (ta && g) g.scrollTop = ta.scrollTop;
}
function updateActiveLineRule() {
  const ta = $('#ed-content'); const rule = $('#ed-active-line'); const g = $('#ed-gutter');
  if (!ta || !rule || !g) return;
  const curIdx = (ta.selectionStart >= 0) ? ta.value.substr(0, ta.selectionStart).split('\n').length : 1;
  const span = g.querySelectorAll('span')[curIdx - 1];
  if (!span) { rule.classList.remove('show'); return; }
  const wrap = ta.parentElement;
  if (rule.parentElement !== wrap) wrap.appendChild(rule);
  rule.style.top = (span.offsetTop - ta.scrollTop) + 'px';
  rule.classList.add('show');
}
function updateEditorStats() {
  const ta = $('#ed-content'); if (!ta) return;
  const w = $('#ed-words'); const l = $('#ed-lines');
  if (w) w.textContent = '字数 ' + ta.value.replace(/\s+/g, ' ').trim().length;
  if (l) l.textContent = '行 ' + ta.value.split('\n').length;
}
function applyEditorTool(name) {
  const ta = $('#ed-content'); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, val = ta.value;
  const sel = val.substring(s, e);
  const before = val.substring(0, s), after = val.substring(e);
  if (name === 'link') {
    const url = window.prompt('链接地址：', 'https://');
    const text = sel || '链接文字';
    ta.value = before + '[' + text + '](' + (url || 'https://') + ')' + after;
    ta.selectionStart = before.length + 1; ta.selectionEnd = before.length + 1 + text.length;
    afterEdEdit(); return;
  }
  if (name === 'img') {
    (async () => {
      const r = await api.invoke('media:list').catch(() => ({ items: [] }));
      const items = (r && r.items) || [];
      let url = '';
      if (items.length) {
        const choices = items.map((it, i) => i + '. ' + it.name + ' (' + ((it.size/1024).toFixed(1) || '0') + ' KB)').join('\n');
        url = window.prompt('选择图片（输入编号，或粘贴 URL）：\n\n' + choices, url);
        if (url === null) return;
        const idx = parseInt(String(url).trim(), 10);
        if (!isNaN(idx) && idx >= 1 && idx <= items.length) url = items[idx - 1].data_url;
      } else {
        url = window.prompt('图片地址（URL 或 data URL）：', 'https://');
        if (!url) return;
      }
      const alt = sel || '图片描述';
      ta.value = before + '![' + alt + '](' + (url || 'https://') + ')' + after;
      ta.selectionStart = before.length + 2; ta.selectionEnd = before.length + 2 + alt.length;
      afterEdEdit();
    })();
    return;
  }
  if (name === 'tab') {
    const ind = '  ';
    ta.value = before + ind + sel + after;
    ta.selectionStart = ta.selectionEnd = s + ind.length;
    afterEdEdit(); return;
  }
  if (name === 'h1' || name === 'h2' || name === 'h3' || name === 'quote' || name === 'ul' || name === 'ol') {
    const pre = name === 'h1' ? '# ' : name === 'h2' ? '## ' : name === 'h3' ? '### ' : name === 'quote' ? '> ' : name === 'ul' ? '- ' : '1. ';
    const lineStart = before.lastIndexOf('\n') + 1;
    ta.value = val.substring(0, lineStart) + pre + val.substring(lineStart);
    ta.selectionStart = ta.selectionEnd = s + pre.length;
    afterEdEdit(); return;
  }
  const wrap = name === 'bold' ? '**' : name === 'italic' ? '*' : name === 'code' ? '`' : '';
  if (!wrap) return;
  const text = sel || (name === 'bold' ? '加粗' : name === 'italic' ? '斜体' : 'code');
  ta.value = before + wrap + text + wrap + after;
  ta.selectionStart = s + wrap.length;
  ta.selectionEnd = s + wrap.length + text.length;
  afterEdEdit();
}
async function renderEditorPreview() {
  const md = $('#ed-content') ? $('#ed-content').value : '';
  const pv = $('#ed-preview'); if (!pv) return;
  if (!md.trim()) { pv.innerHTML = '<div class="empty">预览区</div>'; return; }
  const r = await api.invoke('markdown:render', md);
  pv.innerHTML = (r && r.ok) ? r.html : '<pre>' + esc(md) + '</pre>';
}
async function saveEditor() {
  const btn = $('#ed-save'); if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
  const title = $('#ed-title').value.trim();
  if (!title) { if (btn) { btn.disabled = false; btn.textContent = '保存'; } return toast('请输入标题', 'danger'); }
  const i = {
    title,
    status: $('#ed-status').value,
    tags: $('#ed-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    categories: $('#ed-cats').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    content: $('#ed-content').value
  };
  const r = state.editing != null
    ? await api.invoke('posts:update', state.editing, i)
    : await api.invoke('posts:create', i);
  if (btn) { btn.disabled = false; btn.textContent = '保存'; }
  if (!r || !r.ok) return toast((r && r.error) || '保存失败', 'danger');
  toast('已保存' + (r.sync && r.sync.skipped ? '' : '，已同步到博客'), 'ok');
  closeEditor(); loadPosts();
}
async function importFromFile() {
  const r = await api.invoke('files:openText');
  if (!r || !r.ok) { if (r && r.cancelled) return; return toast((r && r.error) || '导入失败', 'danger'); }
  openEditor({ title: r.title || '', tags: r.tags ? r.tags.split(/[,，]/) : [], categories: r.categories ? r.categories.split(/[,，]/) : [], content: r.content || '', status: 'draft' });
}
function importIntoEditor() {
  api.invoke('files:openText').then(r => {
    if (!r || !r.ok) { if (r && r.cancelled) return; return toast((r && r.error) || '导入失败', 'danger'); }
    const ta = $('#ed-content'); if (ta) { ta.value = (r.content || ''); afterEdEdit(); }
    const t = $('#ed-title'); if (t && !t.value.trim()) t.value = r.title || '';
    toast('已导入正文', 'ok');
  }).catch(() => toast('导入失败', 'danger'));
}
// ===== preview =====
async function renderPreview() {
  const st = await api.invoke('preview:status');
  const running = st.ok && st.status && st.status.running;
  const url     = st.ok && st.status ? st.status.url : '';
  const pid     = st.ok && st.status ? (st.status.pid || '') : '';

  $('#content').innerHTML =
    '<h1 class="page-title">本地预览</h1>'
    + '<div class="page-wrap">'
    + '<div id="pv-page-section" class="section">'
    + '<div class="topbar-row">'
    + '<button class="btn primary"   id="pv-start">' + (running ? '⟳ 重启' : '▶ 启动预览') + '</button>'
    + '<button class="btn"            id="pv-stop"  ' + (running ? '' : 'disabled style="opacity:.4"') + '>■ 停止</button>'
    + '<button class="btn ghost"      id="pv-open"  ' + (running ? '' : 'disabled style="opacity:.4"') + '>在浏览器打开</button>'
    + '<span class="status-pill" id="pv-pill">' + (running ? '✅ 运行中  port:' + (st.status.url || '').split(':').pop() : '未启动') + '</span>'
    + '</div>'
    + '<div class="muted-row">'
    + '启动将在本机运行 <kbd>hexo server</kbd>；自动找空闲端口，成功后打开浏览器。'
    + (running ? ' · 进程 PID: <code>' + esc(pid) + '</code>' : '请先在「设置」中配置博客本地路径。')
    + '</div>'
    + '<div id="pv-host" class="' + (running ? 'pv-frame-host' : 'pv-frame-host hidden') + '">'
    + '  <iframe id="pv-frame" src="' + esc(url || 'about:blank') + '"></iframe>'
    + '</div>'
    + '<div id="pv-msg"  class="status-line"></div>'
    + '<div class="pv-log-section">'
    + '  <div class="pv-log-header">'
    + '    <span class="pv-log-title">📋 运行日志</span>'
    + '    <button class="btn ghost sm" id="pv-log-clear">清空</button>'
    + '  </div>'
    + '  <div id="pv-log-body" class="pv-log-body"></div>'
    + '</div>'
    + '</div>'
    + '<div id="pv-fs-toolbar" class="pv-fs-toolbar hidden">'
    + '  <button class="btn" id="pv-fs-exit" type="button">退出全屏 (F11)</button>'
    + '</div></div>';

  // ── 事件绑定 ─────────────────────────────────────────────────────────────
  $('#pv-start').onclick  = startPreview;
  $('#pv-stop').onclick   = stopPreview;
  $('#pv-open').onclick   = () => { if (url) api.invoke('preview:openBrowser', url); };
  $('#pv-log-clear').onclick = () => { $('#pv-log-body').innerHTML = ''; window._pvLogEntries = []; };
  $('#pv-fs-exit').onclick = togglePreviewFs;

  api.invoke('preview:setF11Hook', true).catch(() => {});
  if (window._pvF11 === undefined) { window._pvF11 = true; api.on('preview:f11', togglePreviewFs); }

  // ── 实时日志 ─────────────────────────────────────────────────────────────
  window._pvLogEntries = [];
  api.on('preview:log', (msg) => {
    if (!window._pvLogEntries) return;
    const ts  = new Date(msg.time || Date.now());
    const hh  = String(ts.getHours()).padStart(2, '0');
    const mm  = String(ts.getMinutes()).padStart(2, '0');
    const ss  = String(ts.getSeconds()).padStart(2, '0');
    const line = esc(hh + ':' + mm + ':' + ss + '  ' + (msg.msg || ''));
    window._pvLogEntries.push(line);
    const body = $('#pv-log-body');
    if (body) {
      body.innerHTML = window._pvLogEntries.join('');
      body.scrollTop = body.scrollHeight;
    }
  });
}

function togglePreviewFs() {
  const sec = $('#pv-page-section'); if (!sec) return;
  const full = sec.classList.toggle('pv-fullscreen');
  const tb = $('#pv-fs-toolbar'); if (tb) tb.classList.toggle('hidden', !full);
}

async function startPreview() {
  const btn = $('#pv-start'); if (btn) { btn.disabled = true;  btn.textContent = '启动中…'; }
  const msg = $('#pv-msg');   if (msg)   msg.textContent = '';

  // 保存当前日志，renderPreview() 会重置它
  const savedLogs = window._pvLogEntries ? [...window._pvLogEntries] : [];

  const r = await api.invoke('preview:start');
  renderPreview(); // 无论成功失败都刷新状态，避免 UI 与真实状态不同步

  // 恢复日志
  if (savedLogs.length > 0) {
    window._pvLogEntries = savedLogs;
    const body = $('#pv-log-body');
    if (body) body.innerHTML = savedLogs.join('');
  }

  if (!r || !r.ok) {
    const m = (r && r.error) || '启动失败';
    if (msg) msg.textContent = m;
    if (r && r.needInstall) {
      if (msg) msg.innerHTML = esc(m) + ' <button class="pill-link" id="pv-install">一键安装 Hexo CLI</button>';
      const ib = $('#pv-install');
      if (ib) ib.onclick = () => api.invoke('env:installHexo').then(() => toast('已安装，请重新启动预览', 'ok'));
    } else {
      toast(m, 'danger');
    }
    return;
  }

  toast('预览启动成功', 'ok');
}

async function stopPreview() {
  await api.invoke('preview:stop');
  toast('预览已停止', '');
  renderPreview();
}

async function renderPages() {
  $('#content').innerHTML = '<h1 class="page-title">自定义页面</h1><div class="page-wrap">'
    + '<div class="section"><div class="section-head"><h2>页面列表</h2><button class="btn primary" id="pg-new">＋ 新建页面</button></div>'
    + '<div id="pg-list">加载中…</div></div></div>';
  $('#pg-new').onclick = () => openPageEditor(null);
  loadPages();
}
async function loadPages() {
  const node = $('#pg-list'); if (!node) return;
  const r = await api.invoke('pages:list');
  if (!r || !r.ok) { node.innerHTML = '<div class="empty">' + esc((r && r.error) || '读取失败') + '</div>'; return; }
  if (!r.pages || !r.pages.length) { node.innerHTML = '<div class="empty">暂无自定义页面，点击「新建页面」开始。</div>'; return; }
  node.innerHTML = '<table><thead><tr><th>标题</th><th>类型</th><th>日期</th><th>操作</th></tr></thead><tbody>'
    + r.pages.map(p => '<tr>'
      + '<td><strong>' + esc(p.title) + '</strong><div class="muted-row">' + esc(p.source_file || '') + '</div></td>'
      + '<td><span class="chip">' + esc(p.layout === 'post' ? '文章' : '页面') + '</span></td>'
      + '<td>' + fmtTime(p.date) + '</td>'
      + '<td class="row-actions"><button class="btn" data-pg="' + esc(p.id) + '" data-act="edit">编辑</button><button class="btn danger" data-pg="' + esc(p.id) + '" data-act="del">删除</button></td>'
      + '</tr>').join('') + '</tbody></table>';
  node.querySelectorAll('[data-pg]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.pg;
      if (btn.dataset.act === 'del') {
        const ok = await confirmModal('确认删除该页面？', '删除', true);
        if (!ok) return;
        const r2 = await api.invoke('pages:delete', id);
        if (!r2.ok) return toast(r2.error || '删除失败', 'danger');
        toast('已删除', 'ok'); loadPages();
      } else {
        // Read file content and open editor
        const bp = await api.invoke('settings:blogConfig');
        if (!bp.ok || !bp.blogPath) return toast('未配置博客路径', 'danger');
        const fs = require('fs');
        const fullPath = require('path').join(bp.blogPath, 'source', '_pages', id);
        let content = '';
        try { content = fs.readFileSync(fullPath, 'utf8'); } catch (_) {}
        openPageEditor({ title: id.replace(/\.md$/i, ''), content });
      }
    };
  });
}
function openPageEditor(page) {
  const p = page || { title: '', content: '', layout: 'page' };
  const overlay = document.createElement('div');
  overlay.className = 'editor-modal-overlay';
  overlay.innerHTML = '<div class="editor-modal-card">'
    + '<div class="editor-header"><div class="eh-left"><input class="eh-title-input" id="pg-title" placeholder="页面标题" value="' + esc(p.title) + '"/></div>'
    + '<button class="editor-close" id="pg-close" type="button">✕</button></div>'
    + '<div class="editor-meta">'
    + '<div class="field"><label>布局类型</label><select id="pg-layout"><option value="page"' + (p.layout !== 'post' ? ' selected' : '') + '>页面</option><option value="post"' + (p.layout === 'post' ? ' selected' : '') + '>文章</option></select></div>'
    + '</div>'
    + '<div class="editor-pane editor-pane-single">'
    + '<div class="col write">'
    + '<div class="col-head"><span class="col-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Markdown</span></div>'
    + '<textarea id="pg-content" placeholder="在此输入 Markdown 正文…" style="padding:20px">' + esc(p.content || '') + '</textarea>'
    + '</div></div>'
    + '<div class="editor-foot">'
    + '<div class="ef-actions"><button class="btn" id="pg-cancel">取消</button><button class="btn primary" id="pg-save">保存</button></div>'
    + '</div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePageEditor(); });
  $('#pg-close').onclick = closePageEditor;
  $('#pg-cancel').onclick = closePageEditor;
  $('#pg-save').onclick = async () => {
    const title = $('#pg-title').value.trim();
    if (!title) return toast('请输入标题', 'danger');
    const content = $('#pg-content').value;
    const layout = $('#pg-layout').value;
    const r = await api.invoke('pages:create', { title, content, layout });
    if (!r || !r.ok) return toast(r.error || '保存失败', 'danger');
    toast('已保存', 'ok'); closePageEditor(); loadPages();
  };
}
function closePageEditor() {
  const ov = document.querySelector('.editor-modal-overlay');
  if (ov) ov.remove();
}
// 热门主题列表（从官方仓库聚合）
const POPULAR_THEMES = [
  { name: 'butterfly', repo: 'https://github.com/jerryc127/hexo-theme-butterfly', desc: '功能丰富的现代化主题', stars: '8k+' },
  { name: 'volantis', repo: 'https://github.com/volantis-x/hexo-theme-volantis', desc: '简洁优雅的主题', stars: '4k+' },
  { name: 'nexmoe', repo: 'https://github.com/nexmoe/hexo-theme-nexmoe', desc: '轻量级卡片式主题', stars: '2k+' },
  { name: 'matery', repo: 'https://github.com/blinkfox/hexo-theme-matery', desc: 'Material Design 风格', stars: '5k+' },
  { name: 'next', repo: 'https://github.com/next-theme/hexo-theme-next', desc: '经典简洁主题', stars: '10k+' },
  { name: 'yaml', repo: 'https://github.com/YueYouth/hexo-theme-yaml', desc: '极简 YAML 主题', stars: '1k+' }
];

// ===== themes & plugins =====
async function renderThemes() {
  $('#content').innerHTML = '<h1 class="page-title">插件管理</h1>'
    + '<div class="page-wrap">'
    + '<div class="section"><h2>已安装插件</h2><div id="pl-list">加载中…</div></div>'
    + '<div class="section"><h2>推荐主题</h2><div id="th-recommended">加载中…</div></div>'
    + '</div>';
  // 离开预览页时关闭 F11 劫持
  api.invoke('preview:setF11Hook', false).catch(() => {});
  loadPlugins(); loadRecommendedThemes();
}
async function refreshThemeHint() {
  const b = await api.invoke('settings:blogConfig');
  const hint = $('#th-hint'); if (!hint) return;
  hint.innerHTML = b.ok && b.blogPath
    ? '当前博客路径：<span class="chip">' + esc(b.blogPath) + '</span> · <button class="pill-link" id="th-goset">去设置修改</button>'
    : '未配置博客本地路径，功能不可用 · <button class="pill-link" id="th-goset">去设置</button>';
  const go = $('#th-goset'); if (go) go.onclick = () => navigate('settings');
}
// 渲染主题市场推荐卡片
function renderThemeMarket() {
  const node = $('#th-market'); if (!node) return;
  node.innerHTML = '<div class="market-rec-grid">' + POPULAR_THEMES.map(t => `
    <div class="market-rec-card">
      <div class="market-rec-top">
        <div class="market-rec-icon">${esc(t.name[0].toUpperCase())}</div>
        <div class="market-rec-info">
          <div class="market-rec-name">${esc(t.name)}</div>
          <div class="market-rec-desc">${esc(t.desc)}</div>
        </div>
      </div>
      <div class="market-rec-stars">⭐ ${esc(t.stars)}</div>
      <div class="market-rec-actions">
        <button class="btn primary btn-sm" data-mr-install="${esc(t.name)}">安装</button>
        <button class="btn btn-sm" data-mr-repo="${esc(t.repo)}">GitHub</button>
      </div>
    </div>`).join('') + '</div>';
  node.querySelectorAll('[data-mr-install]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.mrInstall;
      toast(`正在安装 ${name}...`);
      // Use market service (downloads & extracts tgz), NOT npm install
      const r = await api.invoke('market:installTheme', name);
      if (!r.ok) return toast(r.error || '安装失败', 'danger');
      toast(`已安装 ${r.name}`, 'ok');
      loadThemes();
    };
  });
  node.querySelectorAll('[data-mr-repo]').forEach(btn => {
    btn.onclick = () => api.invoke('preview:openBrowser', btn.dataset.mrRepo);
  });
}
async function loadThemes() {
  const node = $('#th-list'); node.innerHTML = '加载中…';
  const r = await api.invoke('themes:list');
  if (!r.ok) { node.innerHTML = '<div class="empty">' + esc(r.error || '无法读取主题') + '</div>'; return; }
  if (!r.themes || !r.themes.length) { node.innerHTML = '<div class="empty">未发现主题。可在博客 themes/ 目录放置主题，或通过 npm 安装 hexo-theme-* 。</div>'; return; }
  node.innerHTML = '<div class="theme-grid">' + r.themes.map(t => {
    const initial = (t.name || '?').charAt(0).toUpperCase();
    const canDelete = !t.active && t.name !== 'landscape';
    const deleteBtn = canDelete
      ? '<button class="btn danger" data-thdel="' + esc(t.name) + '" title="删除此主题">删除</button>'
      : '';
    const archiveBtn = t.active
      ? '<button class="btn" data-tharchive="' + esc(t.name) + '" title="将当前主题配置归档到备份目录">归档配置</button>'
      : '';
    return '<div class="theme-card ' + (t.active ? 'active' : '') + '">'
      + '<div class="tname"><span class="theme-swatch">' + esc(initial) + '</span>' + esc(t.name) + '</div>'
      + '<div class="tmeta">' + (t.source === 'npm' ? 'npm 包' : '本地目录') + (t.version ? ' · ' + esc(t.version) : '') + ' ' + (t.active ? '<span class="badge ok">当前</span>' : '') + '</div>'
      + '<div class="tacts"><button class="btn primary" data-th="' + esc(t.name) + '" ' + (t.active ? 'disabled' : '') + '>' + (t.active ? '使用中' : '启用') + '</button>'
      + '<button class="btn" data-thprev="' + (t.source === 'npm' ? esc(t.name) : '') + '">在线预览</button>'
      + archiveBtn + deleteBtn + '</div>'
      + '</div>';
  }).join('') + '</div>';
  $$('#th-list [data-th]').forEach(b => b.onclick = async () => {
    const name = b.dataset.th;
    const r2 = await api.invoke('themes:activate', name);
    if (!r2.ok) return toast(r2.error || '切换失败', 'danger');
    let msg = '已切换到主题 ' + name;
    if (r2.restored) msg += '，已自动恢复该主题的归档配置';
    else if (r2.archived) msg += '，已归档旧主题配置';
    toast(msg, 'ok');
    loadThemes();
  });
  $$('#th-list [data-tharchive]').forEach(b => b.onclick = async () => {
    const name = b.dataset.tharchive;
    const r = await api.invoke('themes:archiveConfig', name);
    if (!r.ok) return toast(r.error || '归档失败', 'danger');
    toast('已归档「' + name + '」的配置', 'ok'); loadThemes();
  });
  $$('#th-list [data-thprev]').forEach(b => b.onclick = async () => {
    const name = b.dataset.thprev;
    if (!name) return toast('本地主题暂无在线预览入口', '');
    const u = 'https://' + name + '.hexo.io/';
    const ok = await confirmModal('将在浏览器打开：' + u + ' ?', '打开', false);
    if (ok) api.invoke('preview:openBrowser', u);
  });
  $$('#th-list [data-thdel]').forEach(b => b.onclick = async () => {
    const name = b.dataset.thdel;
    const ok = await confirmModal('确认删除主题「' + name + '」？\n\n删除后无法恢复，请确保已备份。', '删除', true);
    if (!ok) return;
    const r = await api.invoke('themes:uninstall', name);
    if (!r.ok) return toast(r.error || '删除失败', 'danger');
    toast('已删除 ' + name, 'ok');
    loadThemes();
  });
}
async function loadArchivedConfigs() {
  const section = $('#archived-section');
  const node = $('#th-archived');
  if (!node) return;
  const r = await api.invoke('themes:listArchivedConfigs');
  if (!r.ok) { node.innerHTML = '<div class="empty">' + esc(r.error || '无法读取归档') + '</div>'; return; }
  const groups = r.configs || {};
  const entries = Object.keys(groups).sort();
  if (!entries.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const parts = entries.map(theme => {
    const versions = groups[theme] || [];
    const verRows = versions.map(v => {
      const ago = v.mtimeStr ? timeAgo(new Date(v.mtimeStr + 'Z').getTime()) : timeAgo(v.mtime);
      return '<div class="archive-ver">'
        + '<span class="archive-ver-time">' + esc(ago) + '</span>'
        + '<button class="btn primary btn-xs" data-vr="restore-' + esc(theme) + '|' + esc(v.file) + '">恢复此版本</button>'
        + '<button class="btn btn-xs" data-vr="view-' + esc(theme) + '|' + esc(v.file) + '">查看</button>'
        + '</div>';
    }).join('');
    return '<div class="archive-theme-group">'
      + '<div class="archive-group-title">📄 ' + esc(theme) + ' <small>(' + versions.length + ' 份)</small></div>'
      + verRows + '</div>';
  }).join('');
  node.innerHTML = '<div class="archive-list">' + parts.join('') + '</div>';
  node.querySelectorAll('[data-vr^="restore-"]').forEach(btn => {
    btn.onclick = async () => {
      const [theme, file] = btn.dataset.vr.split('|');
      const r2 = await api.invoke('themes:restoreArchivedConfig', theme, file);
      if (!r2.ok) return toast(r2.error || '恢复失败', 'danger');
      toast('已恢复「' + theme + '」' + (file ? '指定版本' : ''), 'ok');
      loadArchivedConfigs();
    };
  });
  node.querySelectorAll('[data-vr^="view-"]').forEach(btn => {
    btn.onclick = async () => {
      const [theme, file] = btn.dataset.vr.split('|');
      const r2 = await api.invoke('config:readArchived', theme, file);
      if (!r2.ok) return toast(r2.error || '读取失败', 'danger');
      openArchivedConfigEditor(r2.theme, r2.content, r2.fileName);
    };
  });
}
// 以归档配置内容初始化编辑器，保存即写入 _config.<theme>.yml
function openArchivedConfigEditor(theme, content) {
  const modal = $('#config-modal'); if (!modal) return;
  const ta = $('#cfg-editor'); if (!ta) return;
  const elCur = $('#cfg-curfile'); if (elCur) elCur.textContent = '_config.' + theme + '.yml';
  const elDirty = $('#cfg-dirty'); if (elDirty) elDirty.classList.add('hidden');
  const elNote = $('#cfg-note'); if (elNote) { elNote.textContent = '正在查看「' + theme + '」的归档配置。修改后点击「保存」会写入到博客的 _config.' + theme + '.yml（当前主题生效）。'; elNote.classList.remove('hidden'); }
  const btnSave = $('#cfg-save'); if (btnSave) { btnSave.disabled = false; }
  const btnRestore = $('#cfg-restore'); if (btnRestore) btnRestore.disabled = false;
  ta.value = content || '';
  ta.dispatchEvent(new Event('input'));
  modal.classList.remove('hidden');
  try { ta.focus(); } catch (e) {}
  // Override save: write to _config.<theme>.yml directly
  if (btnSave) btnSave.onclick = async () => {
    const text = ta.value;
    if (btnSave) btnSave.disabled = true;
    const r = await api.invoke('config:write', text, '_config.' + theme + '.yml');
    if (btnSave) btnSave.disabled = false;
    if (!r || !r.ok) return toast(r.error || '保存失败', 'danger');
    toast('已保存 ' + theme + ' 配置', 'ok');
  };
}

function timeAgo(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
  return d.toLocaleDateString('zh-CN');
}

async function loadPlugins() {
  const node = $('#pl-list'); node.innerHTML = '加载中…';
  const r = await api.invoke('plugins:list');
  if (!r.ok) { node.innerHTML = '<div class="empty">' + esc(r.error || '无法读取插件') + '</div>'; return; }
  if (!r.plugins || !r.plugins.length) { node.innerHTML = '<div class="empty">未发现已安装的 Hexo 插件。可在上方安装 hexo-* 插件。</div>'; return; }
  const catName = { deployer: '部署', generator: '生成', renderer: '渲染', plugin: '功能', other: '其他' };
  const rows = await Promise.all(r.plugins.map(async p => {
    // 检测是否有实质操作（非纯跳过）
    let hasRealAction = false;
    if (p.hasRecipe) {
      const pv = await api.invoke('plugins:previewRecipe', p.name);
      if (pv.ok && pv.writes) {
        hasRealAction = pv.writes.some(w => w.action === 'append' || w.action === 'create' || w.action === 'set');
      }
    }
    const cfgBtn = p.hasRecipe
      ? (hasRealAction
        ? '<button class="btn primary" data-pl="' + esc(p.name) + '" data-act="cfg">配置</button>'
        : '<button class="btn" data-pl="' + esc(p.name) + '" data-act="edit" title="配置已存在，无需修改">已配置</button>')
      : '<button class="btn" data-pl="' + esc(p.name) + '" data-act="edit">编辑配置</button>';
    return '<tr>'
      + '<td><strong>' + esc(p.name) + '</strong></td>'
      + '<td><span class="chip">' + esc(catName[p.category] || p.category || '插件') + '</span></td>'
      + '<td>' + esc(p.version || '—') + '</td>'
      + '<td class="row-actions"><button class="btn danger" data-pl="' + esc(p.name) + '" data-act="rm">卸载</button>' + cfgBtn + '</td></tr>';
  }));
  const rowsHtml = rows.join('');
  node.innerHTML = '<table><thead><tr><th>插件</th><th>类型</th><th>版本</th><th>操作</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
  $$('#pl-list [data-pl]').forEach(b => b.onclick = async () => {
    const name = b.dataset.pl, act = b.dataset.act;
    if (act === 'cfg') return openRecipePreview(name);
    if (act === 'edit') return openConfigEditor({ which: 'site', focusPlugin: name });
    const ok = await confirmModal('确认卸载插件 ' + name + ' 吗？', '卸载', true);
    if (!ok) return;
    toast('正在卸载…');
    const r2 = await api.invoke('plugins:uninstall', name);
    if (!r2.ok) return toast(r2.error || '卸载失败', 'danger');
    toast('已卸载 ' + name, 'ok'); loadPlugins();
  });
}

// 配方预览→确认→应用：plugins:previewRecipe 出「将做的事」，确认后 plugins:applyRecipe 写盘。
// 未收录插件改由「编辑配置」按钮进入通用编辑器（见 openConfigEditor，交接文档 §2.2）。
async function openRecipePreview(pkg) {
  toast('正在生成配方预览…');
  const pv = await api.invoke('plugins:previewRecipe', pkg);
  if (!pv.ok) return toast(pv.error || '无法生成预览', 'danger');
  const lines = [];
  if (pv.writes && pv.writes.length) {
    pv.writes.forEach(w => {
      const mark = w.conflict ? '⚠ ' : (w.action === 'skip' ? '⊘ ' : '✎ ');
      lines.push(mark + (w.label || ''));
    });
  }
  if (!lines.length) lines.push('无需更改，配置已存在。');
  const head = (pv.label ? '【' + pv.label + '】' : '【配置】') + (pv.desc ? ' ' + pv.desc : '');
  const body = head + '\n\n将做以下变更（被修改的文件会先自动备份为 .bak）：\n\n' + lines.join('\n') + (pv.note ? '\n\n说明：' + pv.note : '');
  // 如果所有操作都是跳过/冲突，不弹确认框，直接提示
  const hasChange = pv.writes && pv.writes.some(w => !w.conflict && w.action !== 'skip');
  if (!hasChange) {
    const msg = pv.conflicts && pv.conflicts.length
      ? '以下配置项已存在，不会修改：\n\n' + pv.conflicts.join('\n')
      : '所有配置已存在，无需更改。';
    await confirmModal(msg, '已知晓', false);
    loadPlugins();
    return;
  }
  const ok = await confirmModal(body, '应用配方', false);
  if (!ok) return;
  toast('正在应用配方…');
  const r = await api.invoke('plugins:applyRecipe', pkg);
  if (!r.ok) return toast(r.error || '应用失败', 'danger');
  if (r.applied && r.applied.length) {
    toast('已应用：' + r.applied.join('；') + (r.advice ? ' ' + r.advice : ''), 'ok');
  } else if (r.skipped && r.skipped.length) {
    toast('配置已存在，无需更改', 'ok');
  } else {
    toast('没有可应用的配置变更', 'ok');
  }
  loadPlugins();
}
// ===== Hexo 配置编辑系统（交接文档 §2.2 扩展）=====
// 一个弹窗管理博客根下所有可编辑 _config*.yml：左列选文件，右带行号编辑器；
// 「查看磁盘原版」覆盖只读高亮版用于对比；保存前自动备份 .bak；「恢复备份」仅把最近
// 一次 .bak 读回右侧供核对、绝不自动覆盖原文件（安全红线 §四）。
// options: { which?: 'site' | 'theme', focusPlugin?: string }
function openConfigEditor(options) {
  options = options || {};
  const modal = $('#config-modal');
  if (!modal) return;
  let activeFile = null;       // 当前编辑的文件名（blog 根下）
  let diskText = '';          // 当前文件磁盘上的原始内容（做脏标记 + 重新高亮用）
  let busy = false;           // 进行异步读写时锁按钮
  let peekOn = false;

  const elFilelist = $('#cfg-filelist');
  const elCur = $('#cfg-curfile');
  const elDirty = $('#cfg-dirty');
  const elPeek = $('#cfg-peek');
  const elPeekPane = $('#cfg-peek-pane');
  const elReadonly = $('#cfg-readonly');
  const ta = $('#cfg-editor');
  const elGutter = $('#cfg-gutter');
  const gutterInner = elGutter && elGutter.firstChild;
  const elNote = $('#cfg-note');
  const btnSave = $('#cfg-save');
  const btnRestore = $('#cfg-restore');
  const btnClose = $('#cfg-close');
  const btnCancel = $('#cfg-cancel');
  const elPathHint = $('#cfg-path-hint');

  function esc1(v) { return v == null ? '' : String(v); }

  function setNote(text) {
    if (!elNote) return;
    if (!text) { elNote.classList.add('hidden'); elNote.textContent = ''; }
    else { elNote.classList.remove('hidden'); elNote.textContent = text; }
  }
  function leafOf(fp) {
    if (!fp) return '';
    const parts = String(fp).split(/[\\\/]/);
    return parts[parts.length - 1] || '';
  }
  function setBusy(on) {
    busy = on;
    if (btnSave) btnSave.disabled = busy;
    if (btnRestore) btnRestore.disabled = busy;
  }
  function updateDirty() {
    const dirty = ta.value !== diskText;
    if (elDirty) { if (dirty) elDirty.classList.remove('hidden'); else elDirty.classList.add('hidden'); }
    if (btnSave && !busy) btnSave.disabled = !dirty;
  }
  function renderGutter() {
    if (!gutterInner) return;
    const n = String(ta.value).split(/\n/).length;
    let rows = '';
    for (let i = 1; i <= n; i++) rows = rows + (i === 1 ? '' : '\n') + i;
    gutterInner.textContent = rows;
  }
  function syncGutterScroll() {
    if (!gutterInner) return;
    gutterInner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }
  async function renderReadonly() {
    const text = diskText || '';
    if (elReadonly) elReadonly.textContent = text;
    const r = await api.invoke('config:highlight', text);
    if (r && r.ok && elReadonly && elPeekPane && !elPeekPane.classList.contains('hidden')) elReadonly.innerHTML = r.html;
    else if (r && r.ok && elReadonly) elReadonly.innerHTML = r.html;
  }
  function setPeek(on) {
    peekOn = on;
    if (on) {
      renderReadonly();
      if (elPeekPane) elPeekPane.classList.remove('hidden');
      if (elPeek) { elPeek.classList.add('on'); elPeek.textContent = '隐藏原版'; }
    } else {
      if (elPeekPane) elPeekPane.classList.add('hidden');
      if (elPeek) { elPeek.classList.remove('on'); elPeek.textContent = '查看磁盘原版'; }
    }
  }
  function setActiveItem(name) {
    if (!elFilelist) return;
    elFilelist.querySelectorAll('.cfg-file-item').forEach(n => {
      if (n.dataset.file === name) { n.classList.add('active'); }
      else { n.classList.remove('active'); }
    });
  }
  async function loadFile(name) {
    if (busy) return;
    if (!name) return;
    setBusy(true);
    setNote('正在读取 ' + name + ' …');
    let r;
    try { r = await api.invoke('config:read', name); }
    catch (e) { r = { ok: false, error: (e && e.message) ? e.message : String(e) }; }
    if (!r || !r.ok) {
      setBusy(false);
      setNote(esc1(r && r.error) ? ('读取失败：' + r.error) : '');
      toast(esc1(r && r.error) ? r.error : '读取失败', 'danger');
      return;
    }
    activeFile = name;
    if (r.seeded) { diskText = ''; ta.value = r.text || ''; }   // 磁盘实为 0 字节空文件，回填的主题自带配置显示为未保存草稿，可一键保存写入
    else { diskText = r.text || ''; ta.value = diskText; }
    if (elCur) elCur.textContent = name;
    setActiveItem(name);
    setPeek(false);
    renderGutter();
    ta.scrollTop = 0;
    syncGutterScroll();
    renderReadonly();
    updateDirty();
    setBusy(false);
    setNote(r.note || '保存前会自动备份原文件为 .bak；「恢复备份」载入最近一次备份供核对（不覆盖原文件）。');
  }
  async function save() {
    if (busy || !activeFile) return;
    const text = ta.value;
    setBusy(true);
    setNote('正在保存 ' + activeFile + ' …');
    let r;
    try { r = await api.invoke('config:write', text, activeFile); }
    catch (e) { r = { ok: false, error: (e && e.message) ? e.message : String(e) }; }
    setBusy(false);
    if (!r || !r.ok) {
      setNote(esc1(r && r.error) ? ('保存失败：' + r.error) : '');
      toast(esc1(r && r.error) ? r.error : '保存失败', 'danger');
      return;
    }
    diskText = text;
    renderReadonly();
    updateDirty();
    setNote('已保存 ' + activeFile + '（原文件备份为 ' + leafOf(r.backup) + '）');
    toast('已保存，已自动备份 .bak', 'ok');
  }
  async function restore() {
    if (busy || !activeFile) return;
    setBusy(true);
    let r;
    try { r = await api.invoke('config:readBackup', activeFile); }
    catch (e) { r = { ok: false, error: (e && e.message) ? e.message : String(e) }; }
    setBusy(false);
    if (r && r.ok) {
      ta.value = r.text || '';
      setPeek(false);
      renderGutter();
      syncGutterScroll();
      updateDirty();
      setNote('已载入最近一次备份供核对：' + leafOf(r.backup) + '。确认无误点「保存」即写入磁盘（写前再备份一次）。');
      toast('已载入备份，请核对后保存', '');
    } else {
      const err = esc1(r && r.error) || '暂无备份可恢复';
      toast(err, 'danger');
      setNote(activeFile + '：暂无备份文件可恢复（首次保存过才会生成 .bak）');
    }
  }
  function close() { modal.classList.add('hidden'); }

  async function init() {
    const lr = await api.invoke('config:list');
    if (!lr || !lr.ok) {
      toast(esc1(lr && lr.error) ? lr.error : '读取配置文件清单失败，请先在「设置」配置博客本地路径', 'danger');
      return;
    }
    const files = (lr.files && lr.files.length) ? lr.files : [];
    if (!files.length) { toast('未发现可编辑的配置文件', 'danger'); return; }
    if (elFilelist) {
      elFilelist.innerHTML = files.map(function (f) {
        const badge = '<span class="fbadge kind-' + esc(f.kind) + '">' + esc(f.kind === 'site' ? '站点' : (f.kind === 'theme' ? '当前主题' : (f.kind === 'theme-other' ? '主题' : '其他'))) + '</span>';
        return '<div class="cfg-file-item" data-file="' + esc(f.name) + '" title="' + esc(f.name) + '">'
          + '<span class="fname">' + esc(f.name) + '</span>'
          + '<span class="flabel">' + esc(f.label) + '</span>'
          + badge + '</div>';
      }).join('');
      elFilelist.querySelectorAll('.cfg-file-item').forEach(function (n) {
        n.onclick = function () { if (n.dataset.file !== activeFile) loadFile(n.dataset.file); };
      });
    }
    if (elPathHint) {
      const b = await api.invoke('settings:blogConfig');
      if (b && b.ok && b.blogPath) elPathHint.innerHTML = '<b>博客根</b><br>' + esc(b.blogPath);
      else elPathHint.textContent = '未配置博客本地路径';
    }
    if (btnCancel) btnCancel.onclick = close;
    if (btnClose) btnClose.onclick = close;
    if (btnSave) btnSave.onclick = save;
    if (btnRestore) btnRestore.onclick = restore;
    if (elPeek) elPeek.onclick = function () { setPeek(!peekOn); };
    if (ta) { ta.oninput = function () { renderGutter(); updateDirty(); }; ta.onscroll = syncGutterScroll; }
    let initial = '_config.yml';
    if (options.which === 'theme') { const t = files.find(function (f) { return f.kind === 'theme'; }); if (t) initial = t.name; }
    const found = files.find(function (f) { return f.name === initial; });
    await loadFile((found ? found.name : files[0].name));
    if (options.focusPlugin) setNote('插件「' + options.focusPlugin + '」无内置配方，请在右侧手动追加其配置段（保存会自动备份 ' + esc(activeFile) + '）');
    modal.classList.remove('hidden');
    try { ta.focus(); } catch (e) {}
  }
  init();
}

// ===== deploy =====
async function renderDeploy() {
  const [cfg, hist] = await Promise.all([api.invoke('deploy:getConfig'), api.invoke('deploy:history', 20)]);
  $('#content').innerHTML = '<h1 class="page-title">部署发布</h1><div class="page-wrap">'
    + '<div class="section"><h2>部署配置</h2>'
    + '<div class="field"><label>仓库地址 (repo_url)</label><input id="d-repo" value="' + esc(cfg.ok ? cfg.config.repo_url : '') + '"/></div>'
    + '<div class="field"><label>分支 (branch)</label><input id="d-branch" value="' + esc(cfg.ok ? cfg.config.branch : '') + '"/></div>'
    + '<div class="topbar-row"><button id="d-save" class="btn">保存配置</button><button id="d-deploy" class="btn primary">一键部署</button></div>'
    + '<div class="muted-row">一键部署会依次执行：<kbd>hexo clean</kbd> → <kbd>hexo generate</kbd> → <kbd>hexo deploy</kbd>，确保线上静态站点与本机预览一致。</div>'
    + '<pre id="d-log" class="guide hidden" style="max-height:240px;overflow:auto"></pre>'
    + '<div id="d-result" class="status-line"></div></div>'
    + '<div class="section"><h2>部署历史</h2><div id="d-history">加载中…</div></div></div>';
  $('#d-save').onclick = async () => {
    const r = await api.invoke('deploy:setConfig', { repo_url: $('#d-repo').value, branch: $('#d-branch').value });
    toast(r.ok ? '已保存' : '保存失败', r.ok ? 'ok' : 'danger');
  };
  $('#d-deploy').onclick = async () => {
    const log = $('#d-log'); if (log) { log.classList.remove('hidden'); log.textContent = ''; }
    toast('正在部署：clean → generate → deploy，请稍候…', '');
    const r = await api.invoke('deploy:deploy'); refreshDeployHistory();
    if (!r.ok) {
      $('#d-result').textContent = '部署失败：' + (r.error || '');
      if (log) log.textContent = esc(r.output || r.error || '');
      return toast(r.error, 'danger');
    }
    $('#d-result').textContent = '部署成功';
    if (log) log.textContent = esc(r.output || '');
    toast('部署完成', 'ok');
  };
  refreshDeployHistory();
}
async function refreshDeployHistory() {
  const node = $('#d-history'); if (!node) return;
  const r = await api.invoke('deploy:history', 20);
  if (!r.ok || !r.history || !r.history.length) { node.innerHTML = '<div class="empty">暂无部署记录</div>'; return; }
  node.innerHTML = r.history.map(d => '<div class="timeline-item">'
    + '<div class="muted-row">' + fmtTime(d.created_at) + ' · ' + esc(d.repo_url || '(未配置)') + (d.branch ? '（' + esc(d.branch) + '）' : '') + '</div>'
    + '<div>' + (d.success ? '<span class="badge ok">成功</span>' : '<span class="badge danger">失败</span>') + '</div></div>').join('');
}

// ===== settings =====
async function renderSettings() {
  // Reuse cached theme and background to avoid redundant IPC
  const theme = _themeCache || 'light';
  const bgCfg = _bgCache || { url: '', opacity: 0.4, blur: 0 };
  // Render skeleton immediately (no await) — fills in data after
  $('#content').innerHTML = '<h1 class="page-title">设置</h1><div class="page-wrap">'
    + '<div class="section"><h2>博客配置</h2>'
    + '<div id="s-blog-loading" class="muted-row">加载中…</div>'
    + '<div id="s-blog-fields" class="hidden">'
    + '<div class="field"><label>博客本地路径</label><input id="s-blogpath" placeholder="如 E:\\MyHexo"/></div>'
    + '<div class="muted-row">文章发布/预览/部署都会基于此路径。可直接粘贴博客根目录路径。</div>'
    + '<div class="field"><label>站点标题</label><input id="s-sitetitle"/></div>'
    + '<div class="field"><label>博客网址</label><input id="s-blogurl" placeholder="https://example.com"/></div>'
    + '<button class="btn primary" id="s-save-blog">保存博客配置</button></div></div>'
    + '<div class="section"><h2>个性化</h2>'
    + '<div class="field"><label>主题</label><select id="s-theme"><option value="light">亮色</option><option value="dark">暗色</option></select></div>'
    + '<button class="btn" id="s-save-theme">应用主题</button>'
    + '<div style="margin-top:16px"><label class="section-subtitle">自定义颜色</label></div>'
    + '<div class="muted-row" style="margin-bottom:12px">调整主要颜色变量，实时预览；取消勾选恢复默认值。</div>'
    + '<div id="s-colors-grid" class="colors-grid">加载中…</div>'
    + '<div class="topbar-row" style="margin-top:12px">'
    + '<button class="btn primary" id="s-save-colors">保存配色</button>'
    + '<button class="btn" id="s-reset-colors">恢复默认</button>'
    + '</div>'
    + '<div style="margin-top:24px"><label class="section-subtitle">背景图片</label></div>'
    + '<div class="field" style="margin-top:8px">'
    + '<input id="s-bg-url" type="text" placeholder="输入图片 URL（http/https）..." value=""/>'
    + '</div>'
    + '<div class="topbar-row">'
    + '<button class="btn" id="s-bg-browse">选择本地图片</button>'
    + '<button class="btn primary" id="s-bg-save">应用背景</button>'
    + '<button class="btn" id="s-bg-clear">清除背景</button>'
    + '</div>'
    + '<div class="field" style="margin-top:12px">'
    + '<label>透明度 <span id="s-bg-opacity-val">40%</span></label>'
    + '<input id="s-bg-opacity" type="range" min="0" max="100" value="40"/>'
    + '</div>'
    + '<div class="field">'
    + '<label>模糊程度 <span id="s-bg-blur-val">0px</span></label>'
    + '<input id="s-bg-blur" type="range" min="0" max="20" value="0"/>'
    + '</div>'
    + '</div>'
    + '<div class="section"><h2>数据维护</h2>'
    + '<div class="topbar-row"><button class="btn" id="s-reset-notice" title="让下次启动时再次弹出提醒弹窗">重置启动提醒</button><button class="btn" id="s-export-json">导出 JSON</button><button class="btn" id="s-export-bak">导出 .bak</button><button class="btn danger" id="s-restore">恢复备份</button></div>'
    + '<div id="s-msg" class="status-line"></div></div></div>';
  // Fill in blog config (async, non-blocking)
  const bc = await api.invoke('settings:blogConfig');
  if (bc.ok) {
    const bp = $('#s-blogpath'); if (bp) bp.value = bc.blogPath || '';
    const st = $('#s-sitetitle'); if (st) st.value = bc.siteTitle || '';
    const bu = $('#s-blogurl'); if (bu) bu.value = bc.blogUrl || '';
  }
  const loading = $('#s-blog-loading'); if (loading) loading.remove();
  const fields = $('#s-blog-fields'); if (fields) fields.classList.remove('hidden');
  // Fill in theme & background
  const stSel = $('#s-theme'); if (stSel) stSel.value = theme;
  const bgUrl = $('#s-bg-url'); if (bgUrl) bgUrl.value = bgCfg.url || '';
  const opVal = $('#s-bg-opacity-val'); if (opVal) opVal.textContent = Math.round((bgCfg.opacity || 0.4) * 100) + '%';
  const blVal = $('#s-bg-blur-val'); if (blVal) blVal.textContent = Math.round(bgCfg.blur || 0) + 'px';
  const bgOpSlider = $('#s-bg-opacity'); if (bgOpSlider) bgOpSlider.value = Math.round((bgCfg.opacity || 0.4) * 100);
  const bgBlurSlider = $('#s-bg-blur'); if (bgBlurSlider) bgBlurSlider.value = Math.round(bgCfg.blur || 0);
  // Setup background preview
  const applyBgPreview = () => {
    const url = ($('#s-bg-url') || {}).value || '';
    const opacity = parseFloat(($('#s-bg-opacity') || {}).value || 40) / 100;
    const blur = parseFloat(($('#s-bg-blur') || {}).value || 0);
    let bgLayer = document.getElementById('__bg-layer');
    if (url) {
      if (!bgLayer) {
        bgLayer = document.createElement('div');
        bgLayer.id = '__bg-layer';
        bgLayer.style.cssText = 'position:fixed;inset:0;z-index:-2;pointer-events:none;background-size:cover;background-position:center;background-repeat:no-repeat;background-attachment:fixed;';
        document.body.appendChild(bgLayer);
      }
      bgLayer.style.backgroundImage = 'url(' + url + ')';
      bgLayer.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
      let overlay = document.getElementById('__bg-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = '__bg-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
        document.body.appendChild(overlay);
      }
      overlay.style.background = 'rgba(255,255,255,' + (1 - opacity) + ')';
    } else {
      if (bgLayer) { bgLayer.remove(); }
      const o = document.getElementById('__bg-overlay'); if (o) o.remove();
    }
  };
  const bgOpacityVal = $('#s-bg-opacity-val');
  const bgBlurVal = $('#s-bg-blur-val');
  if (bgOpSlider) bgOpSlider.oninput = () => { const v = Math.round(bgOpSlider.value); if (bgOpacityVal) bgOpacityVal.textContent = v + '%'; applyBgPreview(); };
  if (bgBlurSlider) bgBlurSlider.oninput = () => { const v = Math.round(bgBlurSlider.value); if (bgBlurVal) bgBlurVal.textContent = v + 'px'; applyBgPreview(); };
  const urlInput = $('#s-bg-url');
  if (urlInput) urlInput.oninput = applyBgPreview;
  if (bgCfg.url) applyBgPreview();
  api.invoke('preview:setF11Hook', false).catch(() => {});
  // Build color picker grid (async, non-blocking)
  let customCss = _cssCache || {};
  if (typeof _cssCache === 'undefined') {
    const r = await api.invoke('settings:getCustomCss').catch(() => ({ ok: false, css: {} }));
    customCss = (r && r.ok && r.css) ? r.css : {};
    _cssCache = customCss;
  }
  const colorsGrid = $('#s-colors-grid');
  if (colorsGrid) {
    let group = '';
    colorsGrid.innerHTML = COLOR_PRESETS.map(p => {
      if (p.group !== group) { group = p.group; /* close previous group div if any */ return ''; }
      const val = customCss[p.key] || getComputedVal(p.key);
      return '<div class="color-row">'
        + '<span class="color-label">' + esc(p.label) + '</span>'
        + '<input type="color" class="color-picker" data-key="' + esc(p.key) + '" value="' + esc((val.startsWith('#') ? val : '#2563eb')) + '">'
        + '<input type="text" class="color-text" data-key="' + esc(p.key) + '" value="' + esc(val) + '" placeholder="#2563eb">'
        + '<label class="color-apply"><input type="checkbox" data-key="' + esc(p.key) + '"' + (customCss[p.key] ? ' checked' : '') + '>应用</label>'
        + '</div>';
    }).join('');
    colorsGrid.querySelectorAll('.color-picker').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.key;
        const txt = colorsGrid.querySelector('.color-text[data-key="' + key + '"]');
        if (txt) txt.value = input.value;
        document.documentElement.style.setProperty(key, input.value);
      };
    });
    colorsGrid.querySelectorAll('.color-text').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.key;
        const picker = colorsGrid.querySelector('.color-picker[data-key="' + key + '"]');
        if (picker && /^#[0-9a-fA-F]{6}$/.test(input.value)) picker.value = input.value;
        document.documentElement.style.setProperty(key, input.value);
      };
    });
  }
  $('#s-save-blog').onclick = async () => {
    await Promise.all([
      api.invoke('settings:set', 'blog_path', $('#s-blogpath').value.trim()),
      api.invoke('settings:set', 'site_title', $('#s-sitetitle').value.trim()),
      api.invoke('settings:set', 'blog_url', $('#s-blogurl').value.trim())
    ]);
    toast('已保存博客配置', 'ok');
  };
  $('#s-save-theme').onclick = async () => {
    const t = $('#s-theme').value;
    const r = await api.invoke('settings:setTheme', t);
    if (r.ok) { document.documentElement.setAttribute('data-theme', r.theme); toast('已切换到' + (t === 'dark' ? '暗色' : '亮色') + '主题', 'ok'); }
  };
  $('#s-save-colors').onclick = async () => {
    const overrides = {};
    colorsGrid.querySelectorAll('.color-apply input[type=checkbox]:checked').forEach(cb => {
      const key = cb.dataset.key;
      const txt = colorsGrid.querySelector('.color-text[data-key="' + key + '"]');
      if (txt) overrides[key] = txt.value.trim();
    });
    const r = await api.invoke('settings:setCustomCss', overrides);
    if (r.ok) { toast('配色已保存', 'ok'); } else { toast(r.error || '保存失败', 'danger'); }
  };
  $('#s-reset-colors').onclick = async () => {
    const ok = await confirmModal('将清除自定义配色，恢复主题默认颜色。确定继续吗？', '恢复默认', true);
    if (!ok) return;
    await api.invoke('settings:setCustomCss', {});
    document.documentElement.style.cssText = '';
    applyCustomColors();
    toast('已恢复默认配色', 'ok');
    renderSettings();
  };
  $('#s-bg-browse').onclick = async () => {
    const r = await api.invoke('files:openImage', {});
    if (r.ok && r.dataUrl) {
      const urlEl = $('#s-bg-url'); if (urlEl) urlEl.value = r.dataUrl;
      applyBgPreview();
    }
  };
  $('#s-bg-save').onclick = async () => {
    const url = ($('#s-bg-url') || {}).value || '';
    const opacity = parseFloat(($('#s-bg-opacity') || {}).value || 40) / 100;
    const blur = parseFloat(($('#s-bg-blur') || {}).value || 0);
    const r = await api.invoke('settings:setBackground', { url, opacity, blur });
    if (r.ok) { toast('背景已保存', 'ok'); } else { toast(r.error || '保存失败', 'danger'); }
  };
  $('#s-bg-clear').onclick = async () => {
    const ok = await confirmModal('将清除自定义背景图片，确定继续吗？', '清除背景', true);
    if (!ok) return;
    await api.invoke('settings:clearBackground');
    document.body.style.backgroundImage = '';
    document.body.style.backgroundAttachment = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    toast('已清除背景', 'ok');
    renderSettings();
  };
  $('#s-reset-notice').onclick = async () => {
    const ok = await confirmModal('下次启动时会再次弹出"重要提醒"弹窗。确定重置吗？', '重置', false);
    if (!ok) return;
    const m = $('#s-msg'); if (m) m.textContent = '已重置，下次启动将再次弹出提醒';
    await api.invoke('settings:set', 'notice_dismiss_v1', '');
    toast('已重置启动提醒', 'ok');
  };
  $('#s-export-json').onclick = async () => { const r = await api.invoke('backup:exportJson', {}); toast((r && r.ok) ? '已导出 JSON' : ((r && r.cancelled) ? '' : '导出失败'), r.ok ? 'ok' : 'danger'); };
  $('#s-export-bak').onclick = async () => { const r = await api.invoke('backup:exportBak', {}); toast((r && r.ok) ? '已导出 .bak' : ((r && r.cancelled) ? '' : '导出失败'), r.ok ? 'ok' : 'danger'); };
  $('#s-restore').onclick = async () => {
    const ok = await confirmModal('恢复备份将覆盖当前所有数据，确定继续吗？', '确认恢复', true);
    if (!ok) return;
    const r = await api.invoke('backup:restore', {});
    if (!r.ok) { if (r && r.cancelled) return; return toast((r && r.error) || '恢复失败', 'danger'); }
    toast('已恢复备份，即将刷新', 'ok'); setTimeout(() => location.reload(), 800);
  };
}

// ===== tags / categories =====
async function renderTagsCategories() {
  $('#content').innerHTML = '<h1 class="page-title">标签 / 分类</h1><div class="page-wrap">'
    + '<div class="tag-cat-sections">'
    + '<div class="tag-cat-panel"><h2>标签</h2><div id="tc-tags" class="tc-list">加载中…</div></div>'
    + '<div class="tag-cat-panel"><h2>分类</h2><div id="tc-cats" class="tc-list">加载中…</div></div>'
    + '</div></div>';
  api.invoke('preview:setF11Hook', false).catch(() => {});
  const [tr, cr] = await Promise.all([api.invoke('posts:listTags'), api.invoke('posts:listCategories')]);
  const tags = (tr && tr.ok && tr.tags) || [];
  const cats = (cr && cr.ok && cr.categories) || [];
  if (!tags.length && !cats.length) {
    $('#tc-tags').innerHTML = '<div class="empty">还没有标签，给文章添加标签后会显示在这里。</div>';
    $('#tc-cats').innerHTML = '<div class="empty">还没有分类，给文章添加分类后会显示在这里。</div>';
    return;
  }
  if (tags.length) {
    $('#tc-tags').innerHTML = tags.map(t =>
      '<div class="tc-item">'
        + '<span class="tc-name">' + esc(t.name) + '</span>'
        + '<span class="tc-count">' + t.count + ' 篇</span>'
      + '</div>'
    ).join('');
  } else {
    $('#tc-tags').innerHTML = '<div class="empty">暂无标签</div>';
  }
  if (cats.length) {
    $('#tc-cats').innerHTML = cats.map(c =>
      '<div class="tc-item">'
        + '<span class="tc-name">' + esc(c.name) + '</span>'
        + '<span class="tc-count">' + c.count + ' 篇</span>'
      + '</div>'
    ).join('');
  } else {
    $('#tc-cats').innerHTML = '<div class="empty">暂无分类</div>';
  }
}

// ===== profile =====
async function renderProfile() {
  const [u, stats] = await Promise.all([api.invoke('auth:getProfile'), api.invoke('dashboard:stats'), api.invoke('auth:listLinkedAccounts')]);
  if (!u || !u.ok) { $('#content').innerHTML = '<h1 class="page-title">用户主页</h1><div class="empty">' + esc((u && u.error) || '请先登录') + '</div>'; return; }
  const p = u.profile;
  const s = (stats && stats.ok) ? stats.stats : {};
  const accounts = (u.accounts && u.accounts.accounts) || [];
  const accountHtml = accounts.map(a =>
    '<div class="oauth-account-row">'
    + '<span class="oauth-provider-badge">' + esc(OAUTH_LABELS[a.provider] || a.provider) + '</span>'
    + '<span class="oauth-provider-id">' + esc(a.provider_user_id) + '</span>'
    + '<span class="oauth-linked-at">' + fmtTime(a.linked_at) + '</span>'
    + '<button class="btn ghost danger-sm" data-unlink="' + esc(a.provider) + '">解绑</button>'
    + '</div>'
  ).join('');
  const oauthSection = !accounts.length
    ? '<div class="oauth-empty">暂无已绑定的第三方账号</div>'
    : accountHtml;
  $('#content').innerHTML = '<h1 class="page-title">用户主页</h1>'
    + '<div class="profile-card">'
    + '<div class="profile-head"><span class="profile-avatar">👤</span>'
    + '<div><div class="profile-name">' + esc(p.display_name || p.username) + '</div>'
    + '<div class="profile-meta">@' + esc(p.username) + ' · 注册于 ' + fmtTime(p.created_at) + '</div></div></div>'
    + (p.bio ? '<div class="profile-bio">' + esc(p.bio) + '</div>' : '')
    + '<div class="profile-stats"><span class="chip">已发布 ' + (s.published || 0) + '</span><span class="chip">草稿 ' + (s.draft || 0) + '</span><span class="chip">定时 ' + (s.scheduled || 0) + '</span></div>'
    + '</div>'
    + '<div class="section"><h2>外部账号绑定</h2>'
    + '<div class="oauth-section-hint">绑定后可使用第三方账号快速登录；解绑后需改回密码登录。</div>'
    + '<div class="oauth-accounts-list">' + oauthSection + '</div>'
    + '<div class="oauth-bind-buttons">'
    + OAUTH_PROVIDERS.map(pv => {
        const linked = accounts.some(a => a.provider === pv);
        return '<button class="btn oauth-bind-btn ' + pv + '" data-bind="' + esc(pv) + '"' + (linked ? ' disabled style="opacity:.5"' : '') + '>'
          + (linked ? '已绑定 ' + (OAUTH_LABELS[pv] || pv) : '绑定 ' + (OAUTH_LABELS[pv] || pv))
          + '</button>';
      }).join('')
    + '</div></div>'
    + '<div class="section"><h2>编辑资料</h2>'
    + '<div class="field"><label>登录用户名</label><input id="pf-username" value="' + esc(p.username) + '"/></div>'
    + '<div class="field"><label>显示名称</label><input id="pf-displayname" value="' + esc(p.display_name || '') + '"/></div>'
    + '<div class="field"><label>个人简介</label><textarea id="pf-bio" rows="3">' + esc(p.bio || '') + '</textarea></div>'
    + '<button class="btn primary" id="pf-save">保存资料</button></div>'
    + '<div class="section"><h2>修改密码</h2>'
    + '<div class="field"><label>当前密码</label><input id="pf-old" type="password"/></div>'
    + '<div class="field"><label>新密码</label><input id="pf-new" type="password"/></div>'
    + '<button class="btn" id="pf-pw">修改密码</button></div>';
  api.invoke('preview:setF11Hook', false).catch(() => {});
  $('#pf-save').onclick = async () => {
    const r = await api.invoke('auth:updateProfile', {
      username: $('#pf-username').value.trim(), display_name: $('#pf-displayname').value, bio: $('#pf-bio').value
    });
    if (!r.ok) return toast(r.error || '保存失败', 'danger');
    toast('资料已保存', 'ok'); renderProfile(); renderUserBox();
  };
  $('#pf-pw').onclick = async () => {
    const r = await api.invoke('auth:changePassword', { old_password: $('#pf-old').value, new_password: $('#pf-new').value });
    if (!r.ok) return toast(r.error || '修改失败', 'danger');
    toast('密码已修改', 'ok'); $('#pf-old').value = ''; $('#pf-new').value = '';
  };
  // OAuth bind buttons
  document.querySelectorAll('[data-bind]').forEach(btn => {
    btn.onclick = async () => {
      const provider = btn.dataset.bind;
      btn.disabled = true;
      btn.textContent = '正在跳转...';
      try {
        const r = await api.invoke('auth:oAuthStart', provider);
        if (!r.ok) { toast(r.error || 'OAuth 启动失败', 'danger'); btn.disabled = false; btn.textContent = '绑定 ' + (OAUTH_LABELS[provider] || provider); return; }
        await new Promise((resolve, reject) => {
          let settled = false;
          const settle = (v) => { if (settled) return; settled = true; };
          const timer = setTimeout(() => { settle(); reject(new Error('授权超时，请重试')); }, 300000);
          api.on('oauth:callback', (data) => { clearTimeout(timer); settle(); resolve(data); });
          api.on('oauth:error', (err) => { clearTimeout(timer); settle(); reject(new Error(err || '授权被取消')); });
        });
        const exchangeR = await api.invoke('auth:exchangeOAuthCode', { provider, code: data.code });
        if (!exchangeR.ok) { toast(exchangeR.error || '绑定失败', 'danger'); btn.disabled = false; btn.textContent = '绑定 ' + (OAUTH_LABELS[provider] || provider); return; }
        toast('已绑定 ' + (OAUTH_LABELS[provider] || provider), 'ok');
        renderProfile();
      } catch (err) {
        toast(err.message || '绑定失败', 'danger');
        btn.disabled = false;
        btn.textContent = '绑定 ' + (OAUTH_LABELS[provider] || provider);
      }
    };
  });
  // OAuth unlink buttons
  document.querySelectorAll('[data-unlink]').forEach(btn => {
    btn.onclick = async () => {
      const provider = btn.dataset.unlink;
      const r = await api.invoke('auth:unlinkAccount', provider);
      if (!r.ok) return toast(r.error || '解绑失败', 'danger');
      toast('已解绑 ' + (OAUTH_LABELS[provider] || provider), 'ok');
      renderProfile();
    };
  });
}

// ===== media library =====
async function renderMedia() {
  $('#content').innerHTML = '<h1 class="page-title">图片库</h1><div class="page-wrap">'
    + '<div class="section"><h2>本地图片</h2>'
    + '<div class="topbar-row">'
    + '<button class="btn primary" id="m-up-btn">＋ 上传图片</button>'
    + '<button class="btn" id="m-clear-btn">清空全部</button>'
    + '</div>'
    + '<div id="m-list" class="m-list">加载中…</div></div></div>';
  api.invoke('preview:setF11Hook', false).catch(() => {});
  $('#m-up-btn').onclick = uploadImage;
  $('#m-clear-btn').onclick = async () => {
    const ok = await confirmModal('将删除所有已上传的图片，确定继续吗？', '清空全部', true);
    if (!ok) return;
    const items = await api.invoke('media:list').then(r => r.items || []);
    await Promise.all(items.map(it => api.invoke('media:delete', it.id)));
    toast('已清空', 'ok'); loadMedia();
  };
  loadMedia();
}

async function loadMedia() {
  const node = $('#m-list'); if (!node) return;
  const r = await api.invoke('media:list');
  if (!r.ok || !r.items) { node.innerHTML = '<div class="empty">加载失败</div>'; return; }
  if (!r.items.length) { node.innerHTML = '<div class="empty">暂无图片，点击「上传图片」添加。</div>'; return; }
  node.innerHTML = '<div class="m-grid">' + r.items.map(it => {
    const url = it.data_url || '';
    const sizeStr = it.size ? (it.size < 1024 ? it.size + ' B' : (it.size/1024).toFixed(1) + ' KB') : '';
    return '<div class="m-item">'
      + '<div class="m-thumb' + (!url ? ' m-empty' : '') + '">'
      + (url ? '<img src="' + url + '" alt="' + esc(it.name) + '"/>' : '<span class="m-empty-icon">?</span>')
      + '</div>'
      + '<div class="m-meta"><div class="m-name">' + esc(it.name) + '</div><div class="m-size">' + esc(sizeStr) + '</div></div>'
      + '<button class="m-copy" data-id="' + it.id + '" title="复制图片链接到剪贴板">复制</button>'
      + '<button class="m-del" data-id="' + it.id + '" title="删除">删除</button>'
      + '</div>';
  }).join('') + '</div>';
  node.querySelectorAll('.m-copy').forEach(b => {
    b.onclick = async () => {
      const item = await api.invoke('media:get', b.dataset.id);
      if (item.ok && item.item && item.item.data_url) {
        try { await navigator.clipboard.writeText(item.item.data_url); toast('已复制', 'ok'); }
        catch { toast('复制失败', 'danger'); }
      }
    };
  });
  node.querySelectorAll('.m-del').forEach(b => {
    b.onclick = async () => {
      const ok = await confirmModal('确定删除这张图片吗？', '删除', true);
      if (!ok) return;
      const r2 = await api.invoke('media:delete', b.dataset.id);
      if (r2.ok) { toast('已删除', 'ok'); loadMedia(); } else { toast(r2.error || '删除失败', 'danger'); }
    };
  });
}

async function uploadImage() {
  const r = await api.invoke('files:openImage', {});
  if (!r.ok || r.cancelled || !r.dataUrl) return;
  const ext = (r.path || '').match(/\.[^.]+$/)?.[0] || '.png';
  const name = 'image' + Date.now() + ext;
  const r2 = await api.invoke('media:add', { data_url: r.dataUrl, name, path: r.path || '' });
  if (r2.ok) { toast('已上传: ' + r2.item.name, 'ok'); loadMedia(); }
  else { toast(r2.error || '上传失败', 'danger'); }
}

// ===== notices & hexo plugins =====
async function renderNotices() {
  $('#content').innerHTML = '<h1 class="page-title">公告</h1><div class="page-wrap">'
    + '<div class="section"><h2>软件公告</h2>'
    + '<div class="topbar-row">'
    + '<button class="btn primary" id="n-add-btn">＋ 新建公告</button>'
    + '</div>'
    + '<div id="n-list">加载中…</div></div>'
    + '<div class="section"><h2>Hexo 插件一键部署</h2>'
    + '<div class="muted-row" style="margin-bottom:12px">选择需要安装的插件，一键完成安装和配置。</div>'
    + '<div id="n-plugin-list">加载中…</div></div></div>';
  api.invoke('preview:setF11Hook', false).catch(() => {});
  loadNotices();
  loadPluginRecipes();
}

async function loadNotices() {
  const node = $('#n-list'); if (!node) return;
  const r = await api.invoke('notices:list');
  if (!r.ok || !r.items) { node.innerHTML = '<div class="empty">加载失败</div>'; return; }
  const items = r.items || [];
  if (!items.length) { node.innerHTML = '<div class="empty">暂无公告，点击「新建公告」添加。</div>'; return; }
  node.innerHTML = items.map(it => {
    const priorityClass = it.priority === 'high' ? 'notice-high' : (it.priority === 'medium' ? 'notice-medium' : '');
    const priorityLabel = it.priority === 'high' ? '重要' : (it.priority === 'medium' ? '一般' : '');
    const priorityColor = it.priority === 'high' ? 'var(--danger)' : (it.priority === 'medium' ? 'var(--warn)' : 'var(--muted)');
    return '<div class="notice-item ' + priorityClass + '">'
      + '<div class="notice-header">'
      + '<span class="notice-title">' + esc(it.title) + '</span>'
      + '<span class="notice-priority" style="color:' + priorityColor + '">' + priorityLabel + '</span>'
      + '</div>'
      + '<div class="notice-content">' + esc(it.content || '') + '</div>'
      + '<div class="notice-meta">' + fmtTime(it.updated_at || it.created_at) + '</div>'
      + '<div class="notice-actions">'
      + '<button class="btn ghost sm" data-n-edit="' + it.id + '">编辑</button>'
      + '<button class="btn ghost danger-sm" data-n-del="' + it.id + '">删除</button>'
      + '</div></div>';
  }).join('');
  // 用事件委托，避免时序问题
  node.onclick = async (e) => {
    const btn = e.target.closest('[data-n-edit]');
    if (btn) { editNotice(btn.dataset.nEdit); return; }
    const delBtn = e.target.closest('[data-n-del]');
    if (delBtn) {
      const ok = await confirmModal('确定删除该公告吗？', '删除', true);
      if (!ok) return;
      const r2 = await api.invoke('notices:delete', delBtn.dataset.nDel);
      if (r2.ok) { toast('已删除', 'ok'); loadNotices(); } else { toast(r2.error || '删除失败', 'danger'); }
    }
  };
  const addBtn = $('#n-add-btn');
  if (addBtn) addBtn.onclick = () => editNotice(null);
}

async function loadPluginRecipes() {
  const node = $('#n-plugin-list'); if (!node) return;
  const r = await api.invoke('plugins:list');
  if (!r.ok || !r.plugins) { node.innerHTML = '<div class="empty">无法读取插件列表</div>'; return; }
  // 获取所有可用配方
  const recipePkgs = await api.invoke('plugins:listRecipePackages').catch(() => ({ packages: [] }));
  const available = recipePkgs && recipePkgs.packages ? recipePkgs.packages : [];
  // 已安装
  const installed = (r.plugins || []).map(p => p.name);
  const rows = available.map(pkg => {
    const recipe = require('../core/pluginRecipes').recipeFor(pkg);
    const isInstalled = installed.includes(pkg);
    const label = recipe ? recipe.label : pkg;
    const desc = recipe ? recipe.desc : '';
    const btnHtml = isInstalled
      ? '<button class="btn sm" data-rp="' + esc(pkg) + '" data-act="config" disabled>已安装</button>'
      : '<button class="btn primary sm" data-rp="' + esc(pkg) + '" data-act="install">一键安装</button>';
    return '<div class="recipe-row">'
      + '<div class="recipe-info"><span class="recipe-name">' + esc(label) + '</span><span class="recipe-desc">' + esc(desc) + '</span></div>'
      + '<div class="recipe-actions">' + btnHtml + '</div>'
      + '</div>';
  }).join('');
  node.innerHTML = rows || '<div class="empty">暂无可一键部署的插件。</div>';
  node.onclick = async (e) => {
    const btn = e.target.closest('[data-act="install"]');
    if (btn) {
      const pkg = btn.dataset.rp;
      btn.disabled = true; btn.textContent = '安装中…';
      const ir = await api.invoke('plugins:install', pkg);
      if (ir.ok) {
        toast('已安装 ' + pkg, 'ok');
        // 检查是否有配方，有的话提示用户应用配置
        const recipe = require('../core/pluginRecipes').recipeFor(pkg);
        if (recipe) {
          const applyOk = await confirmModal('「' + recipe.label + '」已安装。是否需要自动配置？\n\n' + (recipe.note || ''), '应用配置', false);
          if (applyOk) {
            const ar = await api.invoke('plugins:applyRecipe', pkg);
            if (ar.ok) toast('配置已应用', 'ok');
            else toast(ar.error || '配置失败', 'danger');
          }
        }
      } else {
        toast(ir.error || '安装失败', 'danger');
      }
      btn.disabled = false; btn.textContent = '一键安装';
      loadPluginRecipes();
    }
  };
}

async function editNotice(id) {
  const existing = id ? await api.invoke('notices:get', id) : null;
  const title = (existing && existing.item && existing.item.title) || '';
  const content = (existing && existing.item && existing.item.content) || '';
  const priority = (existing && existing.item && existing.item.priority) || 'normal';
  const m = $('#modal');
  if (!m) { toast('弹窗组件缺失', 'danger'); return; }
  $('#modal-text').innerHTML = '<div style="text-align:left">'
    + '<div class="field" style="margin-bottom:10px"><label>标题 *</label><input id="n-edit-title" value="' + esc(title) + '" placeholder="公告标题" style="width:100%"/></div>'
    + '<div class="field" style="margin-bottom:10px"><label>优先级</label><select id="n-edit-priority">'
    + '<option value="normal"' + (priority === 'normal' ? ' selected' : '') + '>普通</option>'
    + '<option value="medium"' + (priority === 'medium' ? ' selected' : '') + '>一般</option>'
    + '<option value="high"' + (priority === 'high' ? ' selected' : '') + '>重要</option>'
    + '</select></div>'
    + '<div class="field"><label>内容（Markdown）</label><textarea id="n-edit-content" rows="6" placeholder="输入公告内容…" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:10px;background:var(--panel-2);color:var(--text);font-size:14px;resize:vertical;font-family:inherit;">' + esc(content) + '</textarea></div>'
    + '</div>';
  const okBtn = $('#modal-ok'); okBtn.textContent = '保存'; okBtn.className = 'btn primary';
  const cancelBtn = $('#modal-cancel');
  const close = (result) => { m.classList.add('hidden'); okBtn.onclick = null; cancelBtn.onclick = null; return result; };
  okBtn.onclick = async () => {
    const saveBtn = okBtn;
    saveBtn.disabled = true;
    const t = ($('#n-edit-title') || {}).value.trim();
    const c = ($('#n-edit-content') || {}).value;
    const p = ($('#n-edit-priority') || {}).value || 'normal';
    if (!t) { saveBtn.disabled = false; toast('标题不能为空', 'danger'); return; }
    const saveData = { title: t, content: c, priority: p };
    let r;
    if (id) r = await api.invoke('notices:update', id, saveData);
    else r = await api.invoke('notices:add', saveData);
    if (r.ok) { close(true); toast(id ? '已更新' : '已发布', 'ok'); loadNotices(); }
    else { saveBtn.disabled = false; toast(r.error || '操作失败', 'danger'); }
  };
  cancelBtn.onclick = () => close(false);
  m.classList.remove('hidden');
  setTimeout(() => { const inp = $('#n-edit-title'); if (inp) inp.focus(); }, 50);
}

// ===== Market: Hexo theme/plugin marketplace =====
let _marketTab = 'themes'; // 'themes' | 'plugins'
let _marketSearch = '';
let _marketCategory = 'all';
let _marketResults = [];
let _marketLoading = false;
let _marketDownloading = null; // { name, version, progress, total, xhr }

async function renderMarket() {
  $('#content').innerHTML = `
    <h1 class="page-title">🛒 市场</h1>
    <div class="page-wrap">
      <div class="market-search-bar">
        <input id="market-search" type="text" placeholder="搜索 Hexo 主题或插件…" />
        <button id="market-search-btn" class="btn primary">搜索</button>
        <select id="market-type-filter">
          <option value="themes">主题</option>
          <option value="plugins">插件</option>
        </select>
        <button id="market-refresh" class="btn ghost" title="重新搜索">↻</button>
      </div>
      <div id="market-body" class="market-body">
        <div class="market-empty">在上方搜索框输入关键词搜索主题或插件</div>
      </div>
    </div>
    <!-- 详情弹窗 -->
    <div id="market-detail-modal" class="modal hidden">
      <div class="market-detail-card">
        <div class="market-detail-head">
          <div class="market-detail-name" id="md-name"></div>
          <button class="market-close" id="md-close">&times;</button>
        </div>
        <div class="market-detail-body" id="md-body">加载中…</div>
      </div>
    </div>
    <!-- 下载进度弹窗 -->
    <div id="market-dl-modal" class="modal hidden">
      <div class="market-dl-card">
        <div class="market-dl-head">
          <span id="md-dl-name">正在安装…</span>
          <button class="market-close" id="md-dl-close">&times;</button>
        </div>
        <div class="market-dl-body">
          <div class="market-dl-status" id="md-dl-status">准备中…</div>
          <div class="market-dl-progress-wrap">
            <div class="market-dl-progress-bar" id="md-dl-bar" style="width:0%"></div>
          </div>
          <div class="market-dl-meta" id="md-dl-meta">0%</div>
        </div>
        <div class="market-dl-actions">
          <button class="btn danger" id="md-dl-cancel">取消</button>
        </div>
      </div>
    </div>
  `;

  const typeFilter = $('#market-type-filter');
  const searchInput = $('#market-search');
  const searchBtn = $('#market-search-btn');

  typeFilter.onchange = async () => {
    _marketTab = typeFilter.value;
    _marketSearch = '';
    searchInput.value = '';
    // 切换 tab 时自动加载对应推荐，避免显示空状态
    if (_marketTab === 'themes') {
      const r = await api.invoke('market:searchThemes', '', 24);
      if (r && r.ok) { _marketResults = r.results.slice(0, 24); renderMarketResults(_marketResults); }
    } else {
      const r = await api.invoke('market:searchPlugins', '', 'all', 24);
      if (r && r.ok) { _marketResults = r.results.slice(0, 24); renderMarketResults(_marketResults); }
    }
  };

  searchBtn.onclick = doMarketSearch;
  searchInput.onkeyup = (e) => {
    if (e.key === 'Enter') doMarketSearch();
  };

  $('#market-refresh').onclick = doMarketSearch;

  // 默认：两个 tab 均自动加载推荐列表
  if (_marketTab === 'themes') {
    const r = await api.invoke('market:searchThemes', '', 12);
    if (r && r.ok) { _marketResults = r.results.slice(0, 12); renderMarketResults(_marketResults); }
  } else {
    const r = await api.invoke('market:searchPlugins', '', 'all', 24);
    if (r && r.ok) { _marketResults = r.results.slice(0, 24); renderMarketResults(_marketResults); }
  }

  $('#md-close').onclick = () => { $('#market-detail-modal').classList.add('hidden'); };
  $('#md-dl-close').onclick = () => { $('#market-dl-modal').classList.add('hidden'); };
  $('#md-dl-cancel').onclick = cancelDownload;
}

async function doMarketSearch() {
  const q = ($('#market-search') || {}).value.trim() || '';
  _marketSearch = q;
  _marketCategory = 'all';
  renderMarketResults([]);

  if (!q && _marketTab === 'themes') {
    // Default: show popular themes when no query
    await loadPopularThemes();
    return;
  }

  const filter = _marketTab === 'themes' ? 'themes' : 'plugins';
  toast('正在搜索…');
  let r;
  if (filter === 'themes') {
    r = await api.invoke('market:searchThemes', q, 24);
  } else {
    r = await api.invoke('market:searchPlugins', q, _marketCategory, 24);
  }
  if (!r || !r.ok) {
    toast(r && r.error ? r.error : '搜索失败', 'danger');
    return;
  }
  _marketResults = r.results || [];
  toast(`找到 ${_marketResults.length} 个结果`);
  renderMarketResults(_marketResults);
}

async function loadPopularThemes() {
  // Load a curated set without search
  const r = await api.invoke('market:searchThemes', '', 12);
  if (!r || !r.ok) return;
  _marketResults = r.results.slice(0, 12);
  renderMarketResults(_marketResults);
}

function renderMarketResults(results) {
  const body = $('#market-body');
  if (!body) return;
  if (!results.length) {
    body.innerHTML = '<div class="market-empty">暂无搜索结果，尝试更换关键词或切换分类</div>';
    return;
  }
  body.innerHTML = '<div class="market-grid">' + results.map(item => {
    const stars = item.stars || 0;
    const starsStr = stars > 0 ? `⭐ ${stars.toLocaleString()}` : '';
    const date = item.date ? fmtTime(item.date) : '';
    return `<div class="market-item" data-name="${esc(item.name)}" data-version="${esc(item.version)}">
      <div class="market-item-icon">${esc((item.name || '?').charAt(0).toUpperCase())}</div>
      <div class="market-item-info">
        <div class="market-item-name">${esc(item.name)}</div>
        <div class="market-item-desc">${esc(item.description || '暂无描述')}</div>
        <div class="market-item-meta">
          <span class="market-version">v${esc(item.version)}</span>
          ${date ? '<span class="market-date">' + esc(date) + '</span>' : ''}
          ${starsStr ? '<span class="market-stars">' + starsStr + '</span>' : ''}
        </div>
      </div>
      <div class="market-item-actions">
        <button class="btn ghost sm" data-mp="${esc(item.name)}">详情</button>
        <button class="btn primary sm" data-mpi="${esc(item.name)}">安装</button>
      </div>
    </div>`;
  }).join('') + '</div>';

  body.querySelectorAll('[data-mp]').forEach(btn => {
    btn.onclick = () => showMarketDetail(btn.dataset.mp);
  });
  body.querySelectorAll('[data-mpi]').forEach(btn => {
    btn.onclick = () => installFromMarket(btn.dataset.mpi);
  });
}

async function showMarketDetail(name) {
  const modal = $('#market-detail-modal');
  const nameEl = $('#md-name');
  const bodyEl = $('#md-body');
  if (!modal || !nameEl || !bodyEl) return;

  nameEl.textContent = name;
  bodyEl.innerHTML = '<div class="market-detail-loading">加载中…</div>';
  modal.classList.remove('hidden');

  const r = await api.invoke('market:getPackage', name);
  if (!r || !r.ok) {
    bodyEl.innerHTML = '<div class="market-empty">' + esc(r && r.error ? r.error : '获取详情失败') + '</div>';
    return;
  }

  const verKeys = Object.keys(r.versions || {});
  const latestVer = r.distTags && r.distTags.latest ? r.distTags.latest : (verKeys[0] || '');
  const deps = Object.entries(r.versions && r.versions[latestVer] ? r.versions[latestVer].dependencies || {} : {}).map(([k]) => k);

  let versionsHtml = '';
  for (const v of verKeys.slice(0, 20)) {
    const verInfo = r.versions[v] || {};
    const date = verInfo.date ? fmtTime(verInfo.date) : '';
    const isLatest = v === latestVer;
    versionsHtml += `<div class="market-ver-row ${isLatest ? 'latest' : ''}">
      <span class="market-ver">${esc(v)}${isLatest ? ' <span class="badge ok">latest</span>' : ''}</span>
      <span class="market-ver-date">${esc(date)}</span>
    </div>`;
  }

  const isPlugin = !name.startsWith('hexo-theme-');
  const installNote = isPlugin
    ? '安装后将通过 npm install --save 添加到博客依赖中。'
    : '安装后将自动放入 themes/ 目录，需在 <code>_config.yml</code> 中设置 theme 字段。';

  bodyEl.innerHTML = `
    <div class="market-detail-section">
      <div class="market-detail-label">描述</div>
      <div class="market-detail-value">${esc(r.description || '暂无描述')}</div>
    </div>
    ${r.homepage ? `<div class="market-detail-section">
      <div class="market-detail-label">主页</div>
      <a class="market-link" href="#" data-url="${esc(r.homepage)}">${esc(r.homepage)}</a>
    </div>` : ''}
    ${deps.length ? `<div class="market-detail-section">
      <div class="market-detail-label">依赖 (${deps.length})</div>
      <div class="market-deps">${deps.map(d => `<span class="market-dep-chip">${esc(d)}</span>`).join('')}</div>
    </div>` : ''}
    <div class="market-detail-section">
      <div class="market-detail-label">版本历史 (${verKeys.length} 个)</div>
      <div class="market-versions">${versionsHtml}</div>
    </div>
    <div class="market-install-note">${installNote}</div>
    <div class="market-install-row">
      <select id="md-ver-select">
        ${verKeys.map(v => `<option value="${esc(v)}" ${v === latestVer ? 'selected' : ''}>${esc(v)}${v === latestVer ? ' (latest)' : ''}</option>`).join('')}
      </select>
      <button class="btn primary" id="md-install-btn">安装此版本</button>
      <button class="btn" id="md-open-repo">打开 GitHub</button>
      <button class="btn ghost" id="md-edit-theme-config" style="display:none">编辑主题配置</button>
    </div>
  `;

  const verSelect = $('#md-ver-select');
  const installBtn = $('#md-install-btn');
  const openRepoBtn = $('#md-open-repo');
  const editThemeBtn = $('#md-edit-theme-config');
  if (verSelect) {
    verSelect.onchange = () => { /* just update selection */ };
  }
  if (installBtn) {
    installBtn.onclick = async () => {
      const ver = verSelect ? verSelect.value : latestVer;
      modal.classList.add('hidden');
      await installFromMarket(name, ver);
    };
  }
  if (openRepoBtn) {
    openRepoBtn.onclick = () => {
      api.invoke('preview:openBrowser', r.homepage || `https://www.npmjs.com/package/${name}`).catch(() => {});
    };
  }
  if (editThemeBtn) {
    editThemeBtn.style.display = isPlugin ? 'inline-flex' : 'none';
    editThemeBtn.onclick = async () => {
      modal.classList.add('hidden');
      // Ensure theme config file exists before opening editor
      const r = await api.invoke('config:readTheme');
      if (r && r.ok) {
        const fileName = '_config.' + r.theme + '.yml';
        const listR = await api.invoke('config:list');
        if (listR && listR.ok && !listR.files.some(f => f.name === fileName)) {
          await api.invoke('config:write', fileName, '');
        }
        openConfigEditor({ which: 'theme', focusFile: fileName });
      } else {
        openConfigEditor({ which: 'theme' });
      }
    };
  }
  bodyEl.querySelectorAll('.market-link').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); api.invoke('preview:openBrowser', a.dataset.url).catch(() => {}); };
  });
}

async function installFromMarket(name, version) {
  const ver = version || 'latest';
  const dlModal = $('#market-dl-modal');
  if (!dlModal) return;

  dlModal.classList.remove('hidden');
  const dlName = $('#md-dl-name');
  const dlStatus = $('#md-dl-status');
  const dlBar = $('#md-dl-bar');
  const dlMeta = $('#md-dl-meta');

  if (dlName) dlName.textContent = `正在安装 ${name}`;
  if (dlStatus) dlStatus.textContent = '下载中…';
  if (dlBar) dlBar.style.width = '0%';
  if (dlMeta) dlMeta.textContent = '0%';

  const fn = name.startsWith('hexo-theme-') ? 'market:installTheme' : 'market:installPlugin';
  const r = await api.invoke(fn, name, ver);

  if (dlStatus) dlStatus.textContent = r && r.ok ? '完成' : '失败';
  if (dlBar) dlBar.style.width = r && r.ok ? '100%' : '0%';

  if (r && r.ok) {
    toast(`已安装 ${r.name || name}`, 'ok');
    if (r.note && dlStatus) dlStatus.textContent = r.note;

    // Check if plugin has a recipe for auto-configuration
    if (!name.startsWith('hexo-theme-')) {
      const recipeR = await api.invoke('plugins:previewRecipe', name).catch(() => null);
      if (recipeR && recipeR.ok) {
        const hasChange = recipeR.writes && recipeR.writes.some(w => !w.conflict && w.action !== 'skip');
        if (hasChange) {
          const lines = [];
          recipeR.writes.forEach(w => {
            const mark = w.conflict ? '⚠ ' : (w.action === 'skip' ? '⊘ ' : '✎ ');
            lines.push(mark + (w.label || ''));
          });
          const msg = `【${recipeR.label || name}】${recipeR.desc ? ' — ' + recipeR.desc : ''}\n\n将做以下变更：\n\n` + lines.join('\n') + (recipeR.note ? '\n\n说明：' + recipeR.note : '');
          const ok = await confirmModal(msg, '应用配置', false);
          if (ok) {
            toast('正在应用配置…');
            const applyR = await api.invoke('plugins:applyRecipe', name);
            if (applyR.ok && applyR.applied && applyR.applied.length) {
              toast('配置已应用：' + applyR.applied.join('；'), 'ok');
            } else if (!applyR.ok) {
              toast(applyR.error || '应用配置失败', 'danger');
            }
          }
        } else {
          toast('配置已存在，无需更改', 'ok');
        }
      }
    }

    dlModal.classList.add('hidden');
  } else {
    if (dlStatus) dlStatus.textContent = (r && r.error) || '安装失败';
    if (dlMeta) dlMeta.textContent = '';
    toast(r && r.error ? r.error : '安装失败', 'danger');
  }
}

function cancelDownload() {
  _marketDownloading = null;
  $('#market-dl-modal').classList.add('hidden');
  toast('已取消', 'warn');
}

// ===== 推荐主题 =====
async function loadRecommendedThemes() {
  const node = $('#th-recommended');
  if (!node) return;
  // Use global POPULAR_THEMES (already defined earlier in file)
  node.innerHTML = '<div class="market-rec-grid">' + POPULAR_THEMES.slice(0, 4).map(t => `
    <div class="market-rec-card">
      <div class="market-rec-top">
        <div class="market-rec-icon">${esc(t.name[0].toUpperCase())}</div>
        <div class="market-rec-info">
          <div class="market-rec-name">${esc(t.name)}</div>
          <div class="market-rec-desc">${esc(t.desc)} · ⭐ ${esc(t.stars)}</div>
        </div>
      </div>
      <div class="market-rec-actions">
        <button class="btn primary btn-sm" data-mr-install="${esc(t.name)}">安装</button>
        <button class="btn btn-sm" data-mr-repo="${esc(t.repo)}">GitHub</button>
      </div>
    </div>`).join('') + '</div>';
  node.querySelectorAll('[data-mr-install]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.mrInstall;
      toast(`正在安装 ${name}...`);
      const r = await api.invoke('market:installTheme', name);
      if (!r.ok) return toast(r.error || '安装失败', 'danger');
      toast(`已安装 ${r.name}`, 'ok');
      loadPlugins();
    };
  });
  node.querySelectorAll('[data-mr-repo]').forEach(btn => {
    btn.onclick = () => api.invoke('preview:openBrowser', btn.dataset.mrRepo);
  });
}

// ===== boot =====
window.addEventListener('DOMContentLoaded', boot);
