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
function applyTheme() {
  api.invoke('settings:getTheme').then(r => {
    const t = (r && r.ok && r.theme) ? r.theme : 'light';
    document.documentElement.setAttribute('data-theme', t);
  }).catch(() => {});
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
      ? '<span class="badge ok">已安装 ' + esc(s.version || '') + '</span>'
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
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === state.route));
  const map = {
    dashboard: renderDashboard, posts: renderPosts, preview: renderPreview,
    themes: renderThemes, deploy: renderDeploy, settings: renderSettings, profile: renderProfile
  };
  (map[state.route] || renderDashboard)();
}
function renderUserBox() {
  api.invoke('auth:currentUser').then(r => {
    const u = $('#current-username'); if (!u) return;
    if (r && r.ok && r.user) { state.user = r.user; u.textContent = r.user.username || '—'; }
    else u.textContent = '—';
  }).catch(() => {});
}
// ===== boot =====
function boot() {
  applyTheme();
  $$('.nav-item').forEach(b => b.onclick = () => navigate(b.dataset.route));
  wireAuth();
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

// ===== dashboard =====
async function renderDashboard() {
  $('#content').innerHTML = '<h1 class="page-title">首页 · 概览</h1><div class="cards" id="dash-cards">加载中…</div>'
    + '<div class="section"><h2>最近动态</h2><div id="dash-activity">加载中…</div></div>'
    + '<div class="section"><h2>站点状态</h2><div id="dash-site">加载中…</div></div>';
  const [st, act, site] = await Promise.all([
    api.invoke('dashboard:stats'), api.invoke('dashboard:activity', 12), api.invoke('dashboard:siteStatus')
  ]);
  const cards = $('#dash-cards');
  if (cards && st && st.ok) {
    cards.innerHTML = [
      statCard('已发布', st.stats.published, 'post'),
      statCard('草稿', st.stats.draft, 'draft'),
      statCard('定时', st.stats.scheduled, 'schedule')
    ].join('');
  }
  const actEl = $('#dash-activity');
  if (actEl && act && act.ok) {
    if (!act.activity || !act.activity.length) actEl.innerHTML = '<div class="empty">暂无动态</div>';
    else actEl.innerHTML = act.activity.map(a => '<div class="timeline-item"><div class="muted-row">' + fmtTime(a.time) + '</div><div>' + esc(a.text) + '</div></div>').join('');
  }
  const sEl = $('#dash-site');
  if (sEl && site && site.ok) {
    sEl.innerHTML = '<div class="muted-row">博客地址：' + esc(site.status.blogUrl || '未配置') + '</div>'
      + '<div class="muted-row">最近部署：' + fmtTime(site.status.lastDeployAt) + '</div>';
  }
}
function statCard(label, n, kind) {
  return '<div class="card"><div class="card-label">' + esc(label) + '</div><div class="card-num">' + (n || 0) + '</div></div>';
}

// ===== posts list + editor =====
async function renderPosts() {
  $('#content').innerHTML = '<h1 class="page-title">文章管理</h1>'
    + '<div class="topbar-row"><input id="po-search" placeholder="搜索标题…" value="' + esc(state.search) + '"/>'
    + '<select id="po-filter"><option value="all">全部</option><option value="published">已发布</option><option value="draft">草稿</option><option value="scheduled">定时</option></select>'
    + '<button class="btn primary" id="po-new">＋ 新建文章</button>'
    + '<button class="btn" id="po-scan" title="扫描博客 source/_posts/*.md 一键导入">📥 从博客导入</button>'
    + '<button class="btn" id="po-import" title="选择本地 .txt/.md 文件新建一篇文章">📄 从文件导入</button></div>'
    + '<div id="po-list">加载中…</div>';
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
      + '<td>' + esc((p.tags || []).join(', ')) + '</td>'
      + '<td class="row-actions"><button class="btn" data-po="' + p.id + '" data-act="edit">编辑</button><button class="btn danger" data-po="' + p.id + '" data-act="del">删除</button></td>'
      + '</tr>').join('') + '</tbody></table>';
  $$('#po-list [data-po]').forEach(b => b.onclick = async () => {
    const id = b.dataset.po;
    if (b.dataset.act === 'del') {
      const ok = await confirmModal('确认删除该文章吗？（软件库软删除，博客文件需另行清理）', '删除', true);
      if (!ok) return;
      const r2 = await api.invoke('posts:delete', id);
      if (!r2 || !r2.ok) return toast((r2 && r2.error) || '删除失败', 'danger');
      toast('已删除', 'ok'); loadPosts();
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
    + '<div class="editor-header"><div class="eh-left"><input class="eh-title-input" id="ed-title" placeholder="文章标题" value="' + esc(p.title) + '"/></div>'
    + '<select class="eh-status badge-pill" id="ed-status" data-s="' + esc(p.status || 'draft') + '">'
    + '<option value="draft"' + (p.status === 'draft' ? ' selected' : '') + '>草稿</option>'
    + '<option value="published"' + (p.status === 'published' ? ' selected' : '') + '>已发布</option>'
    + '<option value="scheduled"' + (p.status === 'scheduled' ? ' selected' : '') + '>定时</option>'
    + '</select>'
    + '<button class="editor-close" id="ed-close" type="button">✕</button></div>'
    + '<div class="editor-meta">'
    + '<div class="field"><label>标签（逗号分隔）</label><input id="ed-tags" value="' + esc((p.tags || []).join(', ')) + '"/></div>'
    + '<div class="field"><label>分类（逗号分隔）</label><input id="ed-cats" value="' + esc((p.categories || []).join(', ')) + '"/></div>'
    + '</div>'
    + '<div class="editor-toolbar">'
    + '<span class="et-label">插入</span>'
    + '<button class="tool b" data-tool="h1" title="一级标题">H1</button>'
    + '<button class="tool b" data-tool="h2" title="二级标题">H2</button>'
    + '<button class="tool b" data-tool="h3" title="三级标题">H3</button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool b" data-tool="bold" title="加粗 (Ctrl+B)">B</button>'
    + '<button class="tool i" data-tool="italic" title="斜体 (Ctrl+I)">I</button>'
    + '<button class="tool" data-tool="code" title="行内代码"></></button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="quote" title="引用">❝</button>'
    + '<button class="tool" data-tool="ul" title="无序列表">• 列表</button>'
    + '<button class="tool" data-tool="ol" title="有序列表">1. 列表</button>'
    + '<button class="tool" data-tool="link" title="链接">🔗 链接</button>'
    + '<button class="tool" data-tool="img" title="图片">🖼️ 图片</button>'
    + '<span class="et-sep"></span>'
    + '<button class="tool" data-tool="import" id="ed-import2" title="从本地 .txt/.md 导入到正文">📄 文件导入</button>'
    + '</div>'
    + '<div class="editor-pane">'
    + '<div class="col write">'
    + '<div class="col-head"><span>正文（Markdown）</span><button class="eh-empty-btn" id="ed-clear" type="button">清空</button></div>'
    + '<div class="code-wrap">'
    + '<div class="gutter" id="ed-gutter"></div>'
    + '<textarea id="ed-content" placeholder="在此输入 Markdown 正文…">' + esc(p.content || '') + '</textarea>'
    + '<div class="active-line-rule" id="ed-active-line"></div>'
    + '</div>'
    + '</div>'
    + '<div class="col preview">'
    + '<div class="col-head"><span>预览</span><button class="eh-empty-btn" id="ed-refresh" type="button">刷新</button></div>'
    + '<div id="ed-preview" class="preview"></div>'
    + '</div>'
    + '</div>'
    + '<div class="editor-foot">'
    + '<div class="ef-stats"><span id="ed-words">字数 0</span><span id="ed-lines">行 1</span><span id="ed-source">' + (p.source_file ? '文件：' + esc(p.source_file) : '将自动生成文件名') + '</span></div>'
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
    const url = window.prompt('图片地址：', 'https://');
    const alt = sel || '图片描述';
    ta.value = before + '![' + alt + '](' + (url || 'https://') + ')' + after;
    ta.selectionStart = before.length + 2; ta.selectionEnd = before.length + 2 + alt.length;
    afterEdEdit(); return;
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
  const title = $('#ed-title').value.trim();
  if (!title) return toast('请输入标题', 'danger');
  const i = {
    title,
    status: $('#ed-status').value,
    tags: $('#ed-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    categories: $('#ed-cats').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    content: $('#ed-content').value
  };
  toast('保存中…');
  const r = state.editing != null
    ? await api.invoke('posts:update', state.editing, i)
    : await api.invoke('posts:create', i);
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
  const url = st.ok && st.status ? st.status.url : '';
  $('#content').innerHTML = '<h1 class="page-title">本地预览</h1>'
    + '<div id="pv-page-section" class="section"><div class="topbar-row">'
    + '<button class="btn primary" id="pv-start">' + (running ? '运行中' : '启动预览') + '</button>'
    + '<button class="btn ' + (running ? '' : 'hidden') + '" id="pv-stop">停止</button>'
    + '<button class="btn ' + (running ? '' : 'hidden') + '" id="pv-open">在浏览器打开</button>'
    + '<span class="status-pill" id="pv-pill">' + (running ? '运行中 ' + esc(url) : '未启动') + '</span>'
    + '</div>'
    + '<div class="muted-row">启动将在本机运行 <kbd>hexo server</kbd>，默认端口 4000。请先在「设置」里配置博客本地路径。</div>'
    + '<div id="pv-host" class="' + (running ? 'pv-frame-host' : 'pv-frame-host hidden') + '"><iframe id="pv-frame" src="' + (url || 'about:blank') + '"></iframe></div>'
    + '<div id="pv-msg" class="status-line"></div></div>'
    + '<div id="pv-fs-toolbar" class="pv-fs-toolbar hidden"><button class="btn" id="pv-fs-exit" type="button">退出全屏 (F11)</button></div>';
  $('#pv-start').onclick = startPreview;
  const stopBtn = $('#pv-stop'); if (stopBtn) stopBtn.onclick = stopPreview;
  const openBtn = $('#pv-open'); if (openBtn) openBtn.onclick = () => { if (url) api.invoke('preview:openBrowser', url); };
  const fsExit = $('#pv-fs-exit'); if (fsExit) fsExit.onclick = togglePreviewFs;
  // F11 全屏劫持：进入预览页时开启，离开关闭
  api.invoke('preview:setF11Hook', true).catch(() => {});
  if (window._pvF11 === undefined) { window._pvF11 = true; api.on('preview:f11', togglePreviewFs); }
}
function togglePreviewFs() {
  const sec = $('#pv-page-section'); if (!sec) return;
  const full = sec.classList.toggle('pv-fullscreen');
  const tb = $('#pv-fs-toolbar'); if (tb) tb.classList.toggle('hidden', !full);
}
async function startPreview() {
  const btn = $('#pv-start'); if (btn) { btn.disabled = true; btn.textContent = '启动中…'; }
  const msg = $('#pv-msg'); if (msg) msg.textContent = '';
  const r = await api.invoke('preview:start');
  if (!r || !r.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '启动预览'; }
    const m = (r && r.error) || '启动失败';
    if (msg) msg.textContent = m;
    if (r && r.needInstall) { if (msg) msg.innerHTML = esc(m) + ' <button class="pill-link" id="pv-install">一键安装 Hexo CLI</button>'; const ib = $('#pv-install'); if (ib) ib.onclick = () => api.invoke('env:installHexo').then(() => toast('已安装，请重新启动预览', 'ok')); }
    else toast(m, 'danger');
    return;
  }
  toast('预览已启动', 'ok');
  await pollPreviewReady(r.status.url);
}
async function pollPreviewReady(url) {
  const pill = $('#pv-pill'); if (pill) pill.textContent = '运行中 ' + esc(url) + '（等待就绪…）';
  const host = $('#pv-host'); if (host) { host.classList.remove('hidden'); const f = $('#pv-frame'); if (f) f.src = url; }
  const stopBtn = $('#pv-stop'); if (stopBtn) stopBtn.classList.remove('hidden');
  const openBtn = $('#pv-open'); if (openBtn) openBtn.classList.remove('hidden');
  for (let i = 0; i < 20; i++) {
    await new Promise(res => setTimeout(res, 600));
    const s = await api.invoke('preview:status');
    if (s.ok && s.status && s.status.ready) {
      if (pill) pill.textContent = '运行中 ' + esc(url);
      const f = $('#pv-frame'); if (f) f.src = url;
      return;
    }
  }
  if (pill) pill.textContent = '运行中 ' + esc(url) + '（未检测到就绪信号，可直接在浏览器打开）';
}
async function stopPreview() {
  await api.invoke('preview:stop');
  toast('已停止预览', '');
  renderPreview();
}

// ===== themes & plugins =====
async function renderThemes() {
  $('#content').innerHTML = '<h1 class="page-title">主题与插件</h1>'
    + '<div class="muted-row" id="th-hint">读取配置中的博客本地路径…</div>'
    + '<div class="section"><div class="section-head"><h2>主题</h2><div class="topbar-row"><button class="btn" id="th-browse">浏览在线主题市场</button><button class="btn ghost" id="th-refresh">刷新</button></div></div>'
    + '<div class="plugin-add"><input id="th-name" placeholder="主题名，如 butterfly（或完整包名 hexo-theme-butterfly）"/><button class="btn primary" id="th-install">安装主题</button></div>'
    + '<div id="th-install-msg" class="status-line"></div>'
    + '<div id="th-list">加载中…</div></div>'
    + '<div class="section"><div class="section-head"><h2>插件</h2><button class="btn ghost" id="pl-refresh">刷新</button></div>'
    + '<div class="plugin-add"><input id="pl-name" placeholder="插件名，如 hexo-generator-search"/><button class="btn primary" id="pl-install">安装</button></div>'
    + '<div id="pl-list">加载中…</div></div>';
  // 离开预览页时关闭 F11 劫持
  api.invoke('preview:setF11Hook', false).catch(() => {});
  $('#th-refresh').onclick = loadThemes;
  $('#th-browse').onclick = () => api.invoke('preview:openBrowser', 'https://hexo.io/themes/');
  $('#th-install').onclick = async () => {
    const nm = $('#th-name').value.trim();
    if (!nm) return toast('请输入主题名称', 'danger');
    const msg = $('#th-install-msg'); if (msg) msg.textContent = '正在安装主题…';
    toast('正在安装主题…');
    const r = await api.invoke('themes:install', nm);
    if (!r.ok) { if (msg) msg.textContent = '安装失败：' + esc(r.error || ''); return toast(r.error || '安装失败', 'danger'); }
    toast('已安装 ' + r.name, 'ok'); if (msg) msg.textContent = '已安装 ' + r.name + '，可点击「启用」切换到该主题。';
    $('#th-name').value = ''; loadThemes();
  };
  $('#pl-refresh').onclick = loadPlugins;
  $('#pl-install').onclick = async () => {
    const name = $('#pl-name').value.trim();
    if (!name) return toast('请输入插件名称', 'danger');
    toast('正在安装…');
    const r = await api.invoke('plugins:install', name);
    if (!r.ok) return toast(r.error || '安装失败', 'danger');
    toast('已安装 ' + name, 'ok'); $('#pl-name').value = ''; loadPlugins();
  };
  loadThemes(); loadPlugins(); refreshThemeHint();
}
async function refreshThemeHint() {
  const b = await api.invoke('settings:blogConfig');
  const hint = $('#th-hint'); if (!hint) return;
  hint.innerHTML = b.ok && b.blogPath
    ? '当前博客路径：<span class="chip">' + esc(b.blogPath) + '</span> · <button class="pill-link" id="th-goset">去设置修改</button>'
    : '未配置博客本地路径，功能不可用 · <button class="pill-link" id="th-goset">去设置</button>';
  const go = $('#th-goset'); if (go) go.onclick = () => navigate('settings');
}
async function loadThemes() {
  const node = $('#th-list'); node.innerHTML = '加载中…';
  const r = await api.invoke('themes:list');
  if (!r.ok) { node.innerHTML = '<div class="empty">' + esc(r.error || '无法读取主题') + '</div>'; return; }
  if (!r.themes || !r.themes.length) { node.innerHTML = '<div class="empty">未发现主题。可在博客 themes/ 目录放置主题，或通过 npm 安装 hexo-theme-* 。</div>'; return; }
  node.innerHTML = '<div class="theme-grid">' + r.themes.map(t => {
    const initial = (t.name || '?').charAt(0).toUpperCase();
    return '<div class="theme-card ' + (t.active ? 'active' : '') + '">'
      + '<div class="tname"><span class="theme-swatch">' + esc(initial) + '</span>' + esc(t.name) + '</div>'
      + '<div class="tmeta">' + (t.source === 'npm' ? 'npm 包' : '本地目录') + (t.version ? ' · ' + esc(t.version) : '') + ' ' + (t.active ? '<span class="badge ok">当前</span>' : '') + '</div>'
      + '<div class="tacts"><button class="btn primary" data-th="' + esc(t.name) + '" ' + (t.active ? 'disabled' : '') + '>' + (t.active ? '使用中' : '启用') + '</button><button class="btn" data-thprev="' + (t.source === 'npm' ? esc(t.name) : '') + '">在线预览</button></div>'
      + '</div>';
  }).join('') + '</div>';
  $$('#th-list [data-th]').forEach(b => b.onclick = async () => {
    const name = b.dataset.th;
    const r2 = await api.invoke('themes:activate', name);
    if (!r2.ok) return toast(r2.error || '切换失败', 'danger');
    toast('已切换到主题 ' + name, 'ok'); loadThemes();
  });
  $$('#th-list [data-thprev]').forEach(b => b.onclick = async () => {
    const name = b.dataset.thprev;
    if (!name) return toast('本地主题暂无在线预览入口', '');
    const u = 'https://' + name + '.hexo.io/';
    const ok = await confirmModal('将在浏览器打开：' + u + ' ?', '打开', false);
    if (ok) api.invoke('preview:openBrowser', u);
  });
}
async function loadPlugins() {
  const node = $('#pl-list'); node.innerHTML = '加载中…';
  const r = await api.invoke('plugins:list');
  if (!r.ok) { node.innerHTML = '<div class="empty">' + esc(r.error || '无法读取插件') + '</div>'; return; }
  if (!r.plugins || !r.plugins.length) { node.innerHTML = '<div class="empty">未发现已安装的 Hexo 插件。可在上方安装 hexo-* 插件。</div>'; return; }
  const catName = { deployer: '部署', generator: '生成', renderer: '渲染', plugin: '功能', other: '其他' };
  const rows = r.plugins.map(p => {
    const cfg = p.hasRecipe ? '<button class="btn" data-pl="' + esc(p.name) + '" data-act="cfg">配置</button>' : '';
    return '<tr>'
      + '<td><strong>' + esc(p.name) + '</strong></td>'
      + '<td><span class="chip">' + esc(catName[p.category] || p.category || '插件') + '</span></td>'
      + '<td>' + esc(p.version || '—') + '</td>'
      + '<td class="row-actions"><button class="btn danger" data-pl="' + esc(p.name) + '" data-act="rm">卸载</button>' + cfg + '</td></tr>';
  }).join('');
  node.innerHTML = '<table><thead><tr><th>插件</th><th>类型</th><th>版本</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
  $$('#pl-list [data-pl]').forEach(b => b.onclick = async () => {
    const name = b.dataset.pl, act = b.dataset.act;
    if (act === 'cfg') return openRecipePreview(name);
    const ok = await confirmModal('确认卸载插件 ' + name + ' 吗？', '卸载', true);
    if (!ok) return;
    toast('正在卸载…');
    const r2 = await api.invoke('plugins:uninstall', name);
    if (!r2.ok) return toast(r2.error || '卸载失败', 'danger');
    toast('已卸载 ' + name, 'ok'); loadPlugins();
  });
}

// 配方预览→确认→应用：plugins:previewRecipe 出「将做的事」，确认后 plugins:applyRecipe 写盘。
// 未收录插件不显示「配置」按钮——后续可接通用编辑器（交接文档 §2.2）。
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
  const ok = await confirmModal(body, '应用配方', false);
  if (!ok) return;
  toast('正在应用配方…');
  const r = await api.invoke('plugins:applyRecipe', pkg);
  if (!r.ok) return toast(r.error || '应用失败', 'danger');
  if (r.applied && r.applied.length) toast('已应用：' + r.applied.join('；') + (r.advice ? ' ' + r.advice : ''), 'ok');
  else toast('无需写入（配置已存在或均为冲突）', '');
  loadPlugins();
}
// ===== deploy =====
async function renderDeploy() {
  const [cfg, hist] = await Promise.all([api.invoke('deploy:getConfig'), api.invoke('deploy:history', 20)]);
  $('#content').innerHTML = '<h1 class="page-title">部署发布</h1>'
    + '<div class="section"><h2>部署配置</h2>'
    + '<div class="field"><label>仓库地址 (repo_url)</label><input id="d-repo" value="' + esc(cfg.ok ? cfg.config.repo_url : '') + '"/></div>'
    + '<div class="field"><label>分支 (branch)</label><input id="d-branch" value="' + esc(cfg.ok ? cfg.config.branch : '') + '"/></div>'
    + '<div class="topbar-row"><button id="d-save" class="btn">保存配置</button><button id="d-deploy" class="btn primary">一键部署</button></div>'
    + '<div class="muted-row">一键部署会依次执行：<kbd>hexo clean</kbd> → <kbd>hexo generate</kbd> → <kbd>hexo deploy</kbd>，确保线上静态站点与本机预览一致。</div>'
    + '<pre id="d-log" class="guide hidden" style="max-height:240px;overflow:auto"></pre>'
    + '<div id="d-result" class="status-line"></div></div>'
    + '<div class="section"><h2>部署历史</h2><div id="d-history">加载中…</div></div>';
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
  const [bc, th] = await Promise.all([api.invoke('settings:blogConfig'), api.invoke('settings:getTheme')]);
  const theme = (th && th.ok) ? th.theme : 'light';
  $('#content').innerHTML = '<h1 class="page-title">设置</h1>'
    + '<div class="section"><h2>博客配置</h2>'
    + '<div class="field"><label>博客本地路径</label><input id="s-blogpath" placeholder="如 E:\\MyHexo" value="' + esc(bc.ok ? bc.blogPath : '') + '"/></div>'
    + '<div class="muted-row">文章发布/预览/部署都会基于此路径。可直接粘贴博客根目录路径。</div>'
    + '<div class="field"><label>站点标题</label><input id="s-sitetitle" value="' + esc(bc.ok ? bc.siteTitle : '') + '"/></div>'
    + '<div class="field"><label>博客网址</label><input id="s-blogurl" placeholder="https://example.com" value="' + esc(bc.ok ? bc.blogUrl : '') + '"/></div>'
    + '<button class="btn primary" id="s-save-blog">保存博客配置</button></div>'
    + '<div class="section"><h2>外观</h2>'
    + '<div class="field"><label>主题</label><select id="s-theme"><option value="light">亮色</option><option value="dark">暗色</option></select></div>'
    + '<button class="btn" id="s-save-theme">应用主题</button></div>'
    + '<div class="section"><h2>数据维护</h2>'
    + '<div class="topbar-row"><button class="btn" id="s-reset-notice" title="让下次启动时再次弹出提醒弹窗">重置启动提醒</button><button class="btn" id="s-export-json">导出 JSON</button><button class="btn" id="s-export-bak">导出 .bak</button><button class="btn danger" id="s-restore">恢复备份</button></div>'
    + '<div id="s-msg" class="status-line"></div></div>';
  const stSel = $('#s-theme'); if (stSel) stSel.value = theme;
  api.invoke('preview:setF11Hook', false).catch(() => {});
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

// ===== profile =====
async function renderProfile() {
  const [u, stats] = await Promise.all([api.invoke('auth:getProfile'), api.invoke('dashboard:stats')]);
  if (!u || !u.ok) { $('#content').innerHTML = '<h1 class="page-title">用户主页</h1><div class="empty">' + esc((u && u.error) || '请先登录') + '</div>'; return; }
  const p = u.profile;
  const s = (stats && stats.ok) ? stats.stats : {};
  $('#content').innerHTML = '<h1 class="page-title">用户主页</h1>'
    + '<div class="profile-card">'
    + '<div class="profile-head"><span class="profile-avatar">👤</span>'
    + '<div><div class="profile-name">' + esc(p.display_name || p.username) + '</div>'
    + '<div class="profile-meta">@' + esc(p.username) + ' · 注册于 ' + fmtTime(p.created_at) + '</div></div></div>'
    + (p.bio ? '<div class="profile-bio">' + esc(p.bio) + '</div>' : '')
    + '<div class="profile-stats"><span class="chip">已发布 ' + (s.published || 0) + '</span><span class="chip">草稿 ' + (s.draft || 0) + '</span><span class="chip">定时 ' + (s.scheduled || 0) + '</span></div>'
    + '</div>'
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
}

// ===== boot =====
window.addEventListener('DOMContentLoaded', boot);
