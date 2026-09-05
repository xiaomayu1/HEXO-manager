'use strict';

/**
 * Themes & plugins service — manage a Hexo blog's active theme and installed
 * npm plugins (the hexo-* packages declared in the blog's package.json).
 *
 * Pure Node.js, no Electron. Filesystem and process execution are injectable
 * (opts.fs / opts.spawn) so logic is unit-tested with fakes — same pattern as
 * deploy.js (spawn) and the data layer.
 *
 * What it does NOT do: it never silently removes user config keys. Switching a
 * theme only rewrites the top-level theme: line of _config.yml, preserving
 * every other character of the file.
 */

const fs = require('fs');
const path = require('path');
const { defaultSpawnSync, yamlQuote: utilsYamlQuote, yamlUnquote: utilsYamlUnquote, stripQuotes } = require('./utils');
const defaultRecipes = require('./pluginRecipes').RECIPES;

const _ARCHIVE_RE = /^config\.(.+)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.yml$/;

function archiveDir(blogPath) {
  return path.join(blogPath, 'themes', '.theme_configs');
}

function _archiveFileName(themeName) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', '-');
  return 'config.' + themeName + '.' + ts + '.yml';
}

function listArchivedConfigs(fsx, blogPath) {
  requireBlogPath(blogPath);
  const dir = archiveDir(blogPath);
  let entries = [];
  try { entries = fsx.readdirSync(dir); } catch (e) { return { ok: true, configs: {} }; }
  const groups = {};
  for (const n of entries) {
    if (!n || !_ARCHIVE_RE.test(n)) continue;
    const m = _ARCHIVE_RE.exec(n);
    const themeName = m[1];
    const tsStr = m[2];
    let stat = {};
    try { stat = fsx.statSync(path.join(dir, n)); } catch (e) {}
    const file = { theme: themeName, file: n, mtime: stat.mtime, mtimeStr: tsStr };
    if (!groups[themeName]) groups[themeName] = [];
    groups[themeName].push(file);
  }
  for (const t of Object.keys(groups)) groups[t].sort(function (a, b) { return b.mtime - a.mtime; });
  return { ok: true, configs: groups };
}

function archiveConfig(fsx, blogPath, theme) {
  requireBlogPath(blogPath);
  const themeName = String(theme || '').trim();
  if (!themeName) return { ok: false, error: '主题名称不能为空' };
  const src = path.join(blogPath, '_config.' + themeName + '.yml');
  if (!fs.existsSync(src)) return { ok: false, error: '主题配置不存在：_config.' + themeName + '.yml' };
  const dir = archiveDir(blogPath);
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const name = _archiveFileName(themeName);
  const dest = path.join(dir, name);
  fsx.copyFileSync(src, dest);
  return { ok: true, theme: themeName, file: name, path: dest };
}

function restoreArchivedConfig(fsx, blogPath, theme, file) {
  requireBlogPath(blogPath);
  const themeName = String(theme || '').trim();
  if (!themeName) return { ok: false, error: '主题名称不能为空' };
  const f = file || _archiveFileName(themeName).split('.').slice(2).join('.');
  const archived = path.join(archiveDir(blogPath), f);
  if (!fs.existsSync(archived)) return { ok: false, error: '归档中未找到该配置：' + f };
  const dst = path.join(blogPath, '_config.' + themeName + '.yml');
  fsx.copyFileSync(archived, dst);
  return { ok: true, theme: themeName, restoredFile: f };
}

function pluginCategory(name) {
  if (!name) return 'other';
  if (name.indexOf('hexo-theme-') === 0) return 'theme';
  if (name.indexOf('hexo-deployer-') === 0) return 'deployer';
  if (name.indexOf('hexo-generator-') === 0) return 'generator';
  if (name.indexOf('hexo-renderer-') === 0) return 'renderer';
  if (name.indexOf('hexo-') === 0) return 'plugin';
  return 'other';
}

/**
 * Find the active theme name from _config.yml content by locating the
 * top-level 	heme: line (unindented, not a comment).
 */
function parseActiveTheme(content) {
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const m = /^theme\s*:\s*(!?\S.*)?$/.exec(line);
    if (m) {
      const v = String(m[1] || '').trim();
      if (!v || v[0] === '#') return '';
      return stripThemeQuotes(v);
    }
  }
  return '';
}

function stripThemeQuotes(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length >= 2) {
    const a = s[0], b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1).trim();
  }
  // strip inline comment like 	heme: landscape # note
  const idx = s.indexOf(' #');
  if (idx >= 0) s = s.slice(0, idx).trim();
  return s;
}

/**
 * Returns the _config.yml text with the top-level 	heme: line replaced.
 * If there is no such line, the new line is appended. Comments are preserved.
 */
function applyThemeLine(content, theme) {
  const lines = String(content || '').split(/\r?\n/);
  const next = 'theme: ' + theme;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^theme\s*:/.test(lines[i])) {
      lines[i] = next;
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(next);
  }
  return lines.join('\n');
}

// ---- blog _config.yml / _config.<theme>.yml helpers (交接文档 §3.1/§3.2) ----
// 纯函数，无 fs：fs 在服务层注入，便于用假 fs 单测（与 deploy/scanner 一致）。

function extractTopLevelKeys(text) {
  const out = [];
  const seen = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (/^\s/.test(line)) return;
    if (/^#/.test(line.trim())) return;
    const m = /^([A-Za-z0-9_\-]+)\s*:(.*)?$/.exec(line);
    if (m && !seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  });
  return out;
}

// 把 YAML 片段切成「顶层块」——一个顶层 key + 其后所有缩进/空行，直到下一个顶层 key。
function parseTopLevelBlocks(text) {
  const blocks = [];
  let cur = null;
  const topRe = /^([A-Za-z0-9_\-]+)\s*:/;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (!/^\s/.test(line) && !/^#/.test(line.trim()) && topRe.test(line)) {
      if (cur) blocks.push(cur);
      cur = { key: topRe.exec(line)[1], lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    }
  });
  if (cur) blocks.push(cur);
  return blocks;
}

// 把 segment（一个或多个顶层块）合并进 existing：只追加 existing 缺失的顶层 key。
// 已存在的同段**绝不覆盖**（安全红线 §四），放进 skipped 让 UI 标红、用户手动改。
function mergeYamlSegment(existing, segment) {
  const have = extractTopLevelKeys(existing);
  const blocks = parseTopLevelBlocks(segment);
  let body = String(existing || '');
  const added = [];
  const skipped = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (have.indexOf(b.key) >= 0) { skipped.push(b.key); continue; }
    const chunk = b.lines.join('\n').replace(/\n+$/, '');
    if (body && body.charAt(body.length - 1) !== '\n') body += '\n';
    if (body && body.charAt(body.length - 2) !== '\n') body += '\n';
    body += chunk + '\n';
    added.push(b.key);
  }
  return { content: body, added: added, skipped: skipped };
}

const yamlQuote = utilsYamlQuote;
const yamlUnquote = utilsYamlUnquote;

// 把 items 合并进主题配置 inject.<blockKey> 列表（Butterfly inject.head / inject.bottom）。
// 已存在的项跳过；缺 inject/head 块则补建。约定 4 空格缩进的列表项 `    - <item>`。
function mergeInjectItems(themeContent, blockKey, items) {
  blockKey = blockKey || 'head';
  const its = Array.isArray(items) ? items : (items ? [items] : []);
  const lines = String(themeContent || '').split(/\r?\n/);
  let injectStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^inject\s*:/.test(lines[i])) { injectStart = i; break; }
  }
  if (injectStart < 0) {
    const nb = ['inject:', '  ' + blockKey + ':'];
    for (let k = 0; k < its.length; k++) nb.push('    - ' + yamlQuote(its[k]));
    let tail = lines.join('\n');
    if (tail && tail.charAt(tail.length - 1) !== '\n') tail += '\n';
    return { content: tail + nb.join('\n') + '\n', added: its.slice(), skipped: [] };
  }
  let injectEnd = lines.length;
  for (let j = injectStart + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') continue;
    if (!/^\s/.test(lines[j])) { injectEnd = j; break; }
  }
  const subRe = new RegExp('^  ' + blockKey + '\\s*:');
  let subIdx = -1;
  for (let s = injectStart + 1; s < injectEnd; s++) {
    if (subRe.test(lines[s])) { subIdx = s; break; }
  }
  const existing = [];
  if (subIdx >= 0) {
    for (let e = subIdx + 1; e < injectEnd; e++) {
      if (/^\s*#/.test(lines[e])) continue;
      if (/^\s+-/.test(lines[e])) {
        const raw = lines[e].replace(/^\s+-\s+/, '').replace(/^\s+-$/, '');
        existing.push(yamlUnquote(raw.trim()));
      }
    }
  }
  const added = [], skipped = [];
  for (let m = 0; m < its.length; m++) {
    if (existing.indexOf(its[m]) >= 0) skipped.push(its[m]);
    else added.push(its[m]);
  }
  if (!added.length) return { content: lines.join('\n'), added: added, skipped: skipped };
  if (subIdx < 0) {
    const sub = ['  ' + blockKey + ':'];
    for (let n = 0; n < added.length; n++) sub.push('    - ' + yamlQuote(added[n]));
    const out1 = lines.slice(0, injectStart + 1).concat(sub, lines.slice(injectStart + 1));
    return { content: out1.join('\n'), added: added, skipped: skipped };
  }
  let lastItem = subIdx;
  for (let p = subIdx + 1; p < injectEnd; p++) if (/^\s+-/.test(lines[p])) lastItem = p;
  const ins = [];
  for (let q = 0; q < added.length; q++) ins.push('    - ' + yamlQuote(added[q]));
  const out2 = lines.slice(0, lastItem + 1).concat(ins, lines.slice(lastItem + 1));
  return { content: out2.join('\n'), added: added, skipped: skipped };
}

// 读取顶层标量 key 的值（尽力：剥内联注释 + 引号）。返回 { present, value }。
function getScalarLine(content, key) {
  const lines = String(content || '').split(/\r?\n/);
  const re = new RegExp('^' + key + '\\s*:\\s*(.*)$');
  for (let i = 0; i < lines.length; i++) {
    if (/^\s/.test(lines[i])) continue;
    if (/^#/.test(lines[i].trim())) continue;
    const m = re.exec(lines[i]);
    if (m) {
      let v = String(m[1] || '').split(/\s+#/)[0].trim();
      if (v.length >= 2) {
        if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
            (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
          v = v.slice(1, -1);
        }
      }
      return { present: true, value: v };
    }
  }
  return { present: false, value: null };
}

// 把顶层标量 `key:` 行设为 value：存在则原行重写，不存在则追加。其它行原样保留。
function applyScalarLine(content, key, value) {
  const lines = String(content || '').split(/\r?\n/);
  const next = key + ': ' + value;
  const re = new RegExp('^' + key + '\\s*:');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s/.test(lines[i]) || /^#/.test(lines[i].trim())) continue;
    if (re.test(lines[i])) { lines[i] = next; found = true; break; }
  }
  if (!found) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(next);
  }
  return lines.join('\n');
}

function fileExistsRaw(fsx, p) {
  try { fsx.readFileSync(p, 'utf8'); return true; } catch (e) { return false; }
}

// 增量备份：若目标文件存在，拷到 .bak；若 .bak 已存在则 .bak.2，依次递增。
function backupFileIfExists(fsx, p) {
  if (!fileExistsRaw(fsx, p)) return null;
  let bak = p + '.bak';
  let i = 2;
  while (fileExistsRaw(fsx, bak)) { bak = p + '.bak.' + i; i++; }
  fsx.writeFileSync(bak, fsx.readFileSync(p, 'utf8'), 'utf8');
  return bak;
}

function readBlogPackageJson(fsx, blogPath) {
  const pkgPath = path.join(blogPath, 'package.json');
  let raw;
  try { raw = fsx.readFileSync(pkgPath, 'utf8'); }
  catch (e) { return null; }
  try { return JSON.parse(raw); }
  catch (e) { return null; }
}

function listLocalThemes(fsx, blogPath) {
  const dir = path.join(blogPath, 'themes');
  let names = [];
  try { names = fsx.readdirSync(dir); } catch (e) { names = []; }
  return names
    .filter(function (n) { return n && n[0] !== '.' && n !== '.gitkeep'; })
    .map(function (n) { return { name: n, source: 'local' }; });
}

function listNpmThemes(pkg) {
  if (!pkg || !pkg.dependencies) return [];
  const out = [];
  for (const dep of Object.keys(pkg.dependencies)) {
    if (dep.indexOf('hexo-theme-') === 0) {
      out.push({ name: dep.slice('hexo-theme-'.length), source: 'npm', package: dep, version: pkg.dependencies[dep] });
    }
  }
  return out;
}

function listNpmPlugins(pkg) {
  if (!pkg || !pkg.dependencies) return [];
  const out = [];
  for (const dep of Object.keys(pkg.dependencies)) {
    if (dep.indexOf('hexo-') !== 0 || dep.indexOf('hexo-theme-') === 0) continue;
    out.push({ name: dep, version: pkg.dependencies[dep], category: pluginCategory(dep) });
  }
  return out;
}

function npmSpawner(cmd, args, opts) {
  return defaultSpawnSync(cmd, args, { ...opts, timeout: 180000 });
}

function createThemesService(opts) {
  opts = opts || {};
  const fsx = opts.fs || fs;
  const spawn = opts.spawn || npmSpawner;

  function requireBlogPath(blogPath) {
    if (!blogPath) {
      const e = new Error('尚未配置博客本地路径，请先在设置中设置');
      e.code = 'NO_BLOG_PATH';
      throw e;
    }
  }

  function listThemes(blogPath) {
    requireBlogPath(blogPath);
    const cfgPath = path.join(blogPath, '_config.yml');
    let active = '';
    try { active = parseActiveTheme(fsx.readFileSync(cfgPath, 'utf8')); }
    catch (e) { /* no _config.yml yet */ }

    const byName = {};
    for (const t of listLocalThemes(fsx, blogPath)) byName[t.name] = t;
    for (const t of listNpmThemes(readBlogPackageJson(fsx, blogPath))) {
      if (!byName[t.name]) byName[t.name] = t;
    }
    const themes = Object.keys(byName).sort().map(function (k) {
      const t = byName[k];
      return { name: t.name, source: t.source, version: t.version || '', active: t.name === active };
    });
    return { ok: true, active: active, themes: themes };
  }

  function activateTheme(blogPath, theme) {
    requireBlogPath(blogPath);
    const name = String(theme || '').trim();
    if (!name) {
      const e = new Error('主题名称不能为空');
      e.code = 'EMPTY_THEME';
      throw e;
    }
    // 归档旧主题配置（若有）
    const cfgPath = path.join(blogPath, '_config.yml');
    let content = '';
    try { content = fsx.readFileSync(cfgPath, 'utf8'); } catch (e) { content = ''; }
    const oldTheme = parseActiveTheme(content);
    let archived = null, restored = null;
    if (oldTheme && oldTheme !== name) {
      try {
        const r = archiveConfig(fsx, blogPath, oldTheme);
        if (r.ok) archived = r.theme;
      } catch (_) {}
    }
    // 若归档中有目标主题配置且当前尚无该主题的配置文件，则自动恢复（不覆盖用户已手动写的配置）
    try {
      const targetPath = path.join(blogPath, '_config.' + name + '.yml');
      if (!fs.existsSync(targetPath)) {
        const rr = restoreArchivedConfig(fsx, blogPath, name);
        if (rr.ok) restored = rr.theme;
      }
    } catch (_) {}
    const next = applyThemeLine(content, name);
    fsx.writeFileSync(cfgPath, next, 'utf8');
    return { ok: true, active: name, archived: archived, restored: restored };
  }

  function listPlugins(blogPath) {
    requireBlogPath(blogPath);
    const pkg = readBlogPackageJson(fsx, blogPath);
    const plugins = listNpmPlugins(pkg);
    return { ok: true, plugins: plugins };
  }

  function runNpm(blogPath, action, pkg) {
    const cmd = action === 'uninstall' ? 'uninstall' : 'install';
    const res = spawn('npm', [cmd, '--save', String(pkg || '').trim()], { cwd: blogPath, timeout: 180000 });
    return res;
  }

  function installPlugin(blogPath, pkg) {
    requireBlogPath(blogPath);
    const name = String(pkg || '').trim();
    if (!name) {
      const e = new Error('插件名称不能为空');
      e.code = 'EMPTY_PLUGIN';
      throw e;
    }
    const res = runNpm(blogPath, 'install', name);
    return res && res.ok ? { ok: true, name: name } : { ok: false, error: (res && res.error) || '安装失败', stderr: (res && res.stderr) || '' };
  }

  // 安装 Hexo 主题：允许只填主题名 butterfly 或完整包名 hexo-theme-butterfly。
  function installTheme(blogPath, name) {
    requireBlogPath(blogPath);
    let n = String(name || '').trim();
    if (!n) {
      const e = new Error('主题名称不能为空');
      e.code = 'EMPTY_THEME';
      throw e;
    }
    if (n.indexOf('hexo-theme-') !== 0) n = 'hexo-theme-' + n;
    const res = runNpm(blogPath, 'install', n);
    return res && res.ok ? { ok: true, name: n } : { ok: false, error: (res && res.error) || '安装失败', stderr: (res && res.stderr) || '' };
  }

  function uninstallPlugin(blogPath, pkg) {
    requireBlogPath(blogPath);
    const name = String(pkg || '').trim();
    if (!name) {
      const e = new Error('插件名称不能为空');
      e.code = 'EMPTY_PLUGIN';
      throw e;
    }
    const res = runNpm(blogPath, 'uninstall', name);
    return res && res.ok ? { ok: true, name: name } : { ok: false, error: (res && res.error) || '卸载失败', stderr: (res && res.stderr) || '' };
  }

  // ---- blog config 读/写 + 配方应用（交接文档 §3.2） ----
  // recipes 可注入（opts.recipes）便于用合成配方单测；默认取内置 RECIPES。
  const recipes = opts.recipes || defaultRecipes;
  function recipeFor(pkg) {
    pkg = String(pkg == null ? '' : pkg).trim();
    return (recipes && Object.prototype.hasOwnProperty.call(recipes, pkg)) ? recipes[pkg] : null;
  }

  function readBlogConfigFile(blogPath, fileName) {
    requireBlogPath(blogPath);
    const p = path.join(blogPath, fileName || '_config.yml');
    return fsx.readFileSync(p, 'utf8');
  }
  function writeBlogConfigFile(blogPath, fileName, content) {
    requireBlogPath(blogPath);
    const p = path.join(blogPath, fileName || '_config.yml');
    const bak = backupFileIfExists(fsx, p);
    fsx.writeFileSync(p, content, 'utf8');
    return { ok: true, backup: bak };
  }
  function readBlogConfig(blogPath) { return readBlogConfigFile(blogPath, '_config.yml'); }
  function writeBlogConfig(blogPath, content) { return writeBlogConfigFile(blogPath, '_config.yml', content); }

  function readThemeConfig(blogPath) {
    requireBlogPath(blogPath);
    const cfg = fsx.readFileSync(path.join(blogPath, '_config.yml'), 'utf8');
    const theme = parseActiveTheme(cfg);
    if (!theme) return { ok: false, error: '尚未在 _config.yml 配置主题，无法读取主题配置' };
    const p = path.join(blogPath, '_config.' + theme + '.yml');
    try { return { ok: true, theme: theme, text: fsx.readFileSync(p, 'utf8') }; }
    catch (e) { return { ok: false, error: '主题配置文件不存在：_config.' + theme + '.yml' }; }
  }

  function writeThemeConfig(blogPath, content) {
    requireBlogPath(blogPath);
    const cfg = fsx.readFileSync(path.join(blogPath, '_config.yml'), 'utf8');
    const theme = parseActiveTheme(cfg);
    if (!theme) return { ok: false, error: '尚未在 _config.yml 配置主题，无法写入主题配置' };
    const r = writeBlogConfigFile(blogPath, '_config.' + theme + '.yml', content);
    return { ok: true, backup: r.backup, theme: theme };
  }

  // 读取某配置文件的「最近一次备份」用于在通用编辑器里「恢复备份」回看核对。
  // which='site' → _config.yml；which='theme' → _config.<activeTheme>.yml。
  // 备份为增量 .bak/.bak.2/.bak.3…（见 backupFileIfExists），序号最大者即最近一次写盘前的快照；
  // 只把内容读回给用户核对，绝不自动覆盖原文件（安全红线 §四）。
  function readConfigBackup(blogPath, which) {
    requireBlogPath(blogPath);
    let fileName = '_config.yml';
    if (which && which !== 'site') {
      if (which === 'theme') {
        const cfg = fsx.readFileSync(path.join(blogPath, '_config.yml'), 'utf8');
        const theme = parseActiveTheme(cfg);
        if (!theme) return { ok: false, error: '尚未在 _config.yml 配置主题，无法读取主题备份' };
        fileName = '_config.' + theme + '.yml';
      } else {
        fileName = String(which);
      }
    }
    const base = path.join(blogPath, fileName);
    let latest = null;
    let cand = base + '.bak';
    let i = 2;
    while (fileExistsRaw(fsx, cand) && i < 10000) {
      latest = { text: fsx.readFileSync(cand, 'utf8'), backup: cand };
      cand = base + '.bak.' + i;
      i++;
    }
    if (!latest) return { ok: false, error: '暂无备份可恢复' };
    return { ok: true, text: latest.text, backup: latest.backup };
  }

  // 把博客根目录下可由「通用编辑系统」管理的配置文件打成清单：_config.yml + 所有 _config.<x>.yml
  // （以及其他 _config 开头的 yaml，兜底）。只列已存在的真实文件，绝不主动创建。
  // kind: 'site' | 'theme'(当前主题配置) | 'theme-other'(非活动主题配置) | 'other'（都不写主题模板源码，安全红线 §四）。
  function listBlogConfigFiles(blogPath) {
    requireBlogPath(blogPath);
    let activeTheme = '';
    try { activeTheme = parseActiveTheme(fsx.readFileSync(path.join(blogPath, '_config.yml'), 'utf8')) || ''; } catch (e) {}
    let entries = [];
    try { entries = fsx.readdirSync(blogPath); } catch (e) { entries = []; }
    const cfgRe = /^_config.*\.ya?ml$/i;
    const seen = {};
    const files = [];
    if (fileExistsRaw(fsx, path.join(blogPath, '_config.yml'))) {
      files.push({ name: '_config.yml', label: '站点配置', kind: 'site', active: true });
      seen['_config.yml'] = true;
    }
    const sorted = entries.slice().sort();
    for (let k = 0; k < sorted.length; k++) {
      const base = String(sorted[k]).split(/[\\/]/).pop();
      if (!cfgRe.test(base) || seen[base]) continue;
      seen[base] = true;
      const m = /^_config\.(.+)\.ya?ml$/i.exec(base);
      let kind = 'other', label = base;
      if (m) {
        const t = m[1];
        kind = (t === activeTheme) ? 'theme' : 'theme-other';
        label = (t === activeTheme) ? ('主题配置 · ' + t + ' · 当前') : ('主题配置 · ' + t);
      }
      files.push({ name: base, label: label, kind: kind, active: kind === 'theme' });
    }
    return { ok: true, files: files, activeTheme: activeTheme };
  }

  // 计算「配方」的预演：会写入什么、跳过什么、哪些文件已存在（冲突，绝不覆盖）。
  function computeRecipePlan(blogPath, pkg) {
    requireBlogPath(blogPath);
    const recipe = recipeFor(pkg);
    if (!recipe) return { ok: false, error: '该插件暂无内置配方：' + pkg + '。请在「编辑配置」中手动添加。' };
    const cfgPath = path.join(blogPath, '_config.yml');
    let existing = '';
    try { existing = fsx.readFileSync(cfgPath, 'utf8'); } catch (e) { existing = ''; }
    // 配方 config 段：只追加缺失顶层 key，已存在的不动
    const merged = recipe.config ? mergeYamlSegment(existing, recipe.config)
                                 : { content: existing, added: [], skipped: [] };
    let finalConfig = merged.content;
    // permalink 为受管理的单值标量：预演里明示「将覆盖」，写时自动备份，可回滚
    let permAction = 'none';
    let permExisting = null;
    if (recipe.permalink) {
      const pc = getScalarLine(existing, 'permalink');
      permExisting = pc.value;
      if (!pc.present) permAction = 'set';
      else if (pc.value === recipe.permalink) permAction = 'none';
      else permAction = 'set';
      if (permAction === 'set') finalConfig = applyScalarLine(finalConfig, 'permalink', recipe.permalink);
    }
    const configChanged = finalConfig !== existing;
    // 主题 inject（若配了主题）
    let injectPlan = null;
    if (recipe.inject) {
      const theme = parseActiveTheme(existing);
      const supported = (recipe.supportedThemes || []).map(s => s.toLowerCase());
      const themeCompat = !supported.length || !theme || supported.indexOf(theme.toLowerCase()) >= 0;
      if (!theme) {
        injectPlan = { theme: '', file: '', added: [], skipped: [], note: '未配置主题，已跳过 inject', compat: false, compatNote: '尚未配置主题，inject 注入无法应用。请先切换到 Butterfly/Volantis/Next 等支持 inject 的主题。' };
      } else if (!themeCompat) {
        injectPlan = { theme: theme, file: '', added: [], skipped: [], note: '当前主题「' + theme + '」不支持 inject 注入', compat: false, compatNote: '该插件需要主题支持 inject.head / inject.bottom 注入点（如 Butterfly、Volantis、NexT、Redefine、Fluid、Melody、Matery）。请切换主题或手动编辑 _config.<theme>.yml。' };
      } else {
        const tPath = path.join(blogPath, '_config.' + theme + '.yml');
        let tContent = '';
        try { tContent = fsx.readFileSync(tPath, 'utf8'); } catch (e) { tContent = ''; }
        let added = [], skipped = [];
        if (recipe.inject.head && recipe.inject.head.length) {
          const r1 = mergeInjectItems(tContent, 'head', recipe.inject.head);
          tContent = r1.content; added = added.concat(r1.added); skipped = skipped.concat(r1.skipped);
        }
        if (recipe.inject.bottom && recipe.inject.bottom.length) {
          const r2 = mergeInjectItems(tContent, 'bottom', recipe.inject.bottom);
          tContent = r2.content; added = added.concat(r2.added); skipped = skipped.concat(r2.skipped);
        }
        injectPlan = { theme: theme, file: tPath, content: tContent, added: added, skipped: skipped, existed: fileExistsRaw(fsx, tPath), compat: true, compatNote: '' };
      }
    }
    // 主题配置（themeConfig：按主题写入 _config.<theme>.yml，仅适用于当前活动主题）
    let themeConfigPlan = null;
    if (recipe.themeConfig) {
      const activeTheme = parseActiveTheme(existing);
      const themeCfg = recipe.themeConfig[activeTheme];
      if (themeCfg) {
        const tPath = path.join(blogPath, '_config.' + activeTheme + '.yml');
        let tContent = '';
        try { tContent = fsx.readFileSync(tPath, 'utf8'); } catch (e) { tContent = ''; }
        const merged = mergeYamlSegment(tContent, themeCfg);
        themeConfigPlan = { theme: activeTheme, file: tPath, content: merged.content, added: merged.added, skipped: merged.skipped, existed: fileExistsRaw(fsx, tPath) };
      }
    }
    // 博客本地 scripts（hexo 启动时执行）/ source 静态资源
    const scripts = [];
    const assets = [];
    if (recipe.scripts) {
      for (let i = 0; i < recipe.scripts.length; i++) {
        const sc = recipe.scripts[i];
        const sp = path.join(blogPath, 'scripts', sc.file);
        scripts.push({ file: sc.file, path: sp, exists: fileExistsRaw(fsx, sp) });
      }
    }
    if (recipe.assets) {
      for (let j = 0; j < recipe.assets.length; j++) {
        const as = recipe.assets[j];
        const ap = path.join(blogPath, 'source', as.file);
        assets.push({ file: as.file, path: ap, exists: fileExistsRaw(fsx, ap) });
      }
    }
    return {
      ok: true, recipe: recipe, pkg: pkg, existing: existing,
      configChanged: configChanged, configAdded: merged.added, configSkipped: merged.skipped,
      permalinkValue: recipe.permalink || null, permalinkExisting: permExisting, permalinkAction: permAction,
      finalConfig: finalConfig, inject: injectPlan, themeConfig: themeConfigPlan, scripts: scripts, assets: assets
    };
  }

  // 把预演结果拍平成给 UI 的「将做的事」清单。
  function summarizePlan(plan) {
    const writes = [];
    const skipped = [];
    const conflicts = [];
    if (plan.configAdded && plan.configAdded.length)
      writes.push({ kind: 'config', file: '_config.yml', action: 'append', label: '_config.yml — 追加 ' + plan.configAdded.join(', ') + ' 段' });
    if (plan.configSkipped && plan.configSkipped.length) {
      // 如果主题兼容且有 inject 配置，静默处理已存在的配置
      const hasInject = plan.inject && plan.inject.compat;
      if (!hasInject || plan.skippedSomeInject) {
        const l = '_config.yml — 跳过 ' + plan.configSkipped.join(', ') + ' 段（已存在，未覆盖）';
        writes.push({ kind: 'config', file: '_config.yml', action: 'skip', label: l }); skipped.push(l);
      }
    }
    if (plan.permalinkAction === 'set') {
      const v = plan.permalinkExisting == null ? '(空)' : plan.permalinkExisting;
      writes.push({ kind: 'config', file: '_config.yml', action: 'set', label: '_config.yml — permalink：『' + v + '』 → 『' + plan.permalinkValue + '』（原文件自动备份）' });
    }
    for (let i = 0; i < (plan.scripts || []).length; i++) {
      const x = plan.scripts[i];
      if (x.exists) {
        const l = 'scripts/' + x.file + ' — 已存在，已跳过（不覆盖博客本地脚本）';
        writes.push({ kind: 'script', file: 'scripts/' + x.file, action: 'skip', label: l, conflict: true });
        conflicts.push(l); skipped.push(l);
      } else {
        writes.push({ kind: 'script', file: 'scripts/' + x.file, action: 'create', label: 'scripts/' + x.file + ' — 新建博客扩展脚本（hexo 启动时加载执行）' });
      }
    }
    for (let j = 0; j < (plan.assets || []).length; j++) {
      const a = plan.assets[j];
      if (a.exists) {
        const l = 'source/' + a.file + ' — 已存在，已跳过';
        writes.push({ kind: 'asset', file: 'source/' + a.file, action: 'skip', label: l, conflict: true });
        conflicts.push(l); skipped.push(l);
      } else {
        writes.push({ kind: 'asset', file: 'source/' + a.file, action: 'create', label: 'source/' + a.file + ' — 新建静态资源' });
      }
    }
    if (plan.inject) {
      if (!plan.inject.compat) {
        // Theme not compatible or not configured
        if (plan.inject.compatNote) {
          writes.push({ kind: 'inject', file: '', action: 'skip', label: plan.inject.compatNote, conflict: true });
          skipped.push(plan.inject.compatNote);
        } else {
          writes.push({ kind: 'inject', file: '', action: 'skip', label: 'inject：未配置主题，已跳过' });
          skipped.push('inject 跳过');
        }
      } else if (plan.inject.added && plan.inject.added.length) {
        writes.push({ kind: 'inject', file: '_config.' + plan.inject.theme + '.yml', action: 'append', label: '_config.' + plan.inject.theme + '.yml — inject 追加 ' + plan.inject.added.length + ' 项：' + plan.inject.added.join(' | ') });
      } else if (plan.inject.skipped && plan.inject.skipped.length) {
        const l = '_config.' + plan.inject.theme + '.yml — inject 项已存在，跳过';
        writes.push({ kind: 'inject', action: 'skip', file: '_config.' + plan.inject.theme + '.yml', label: l }); skipped.push(l);
      }
    }
    // Theme config (themeConfig: per-theme settings in _config.<theme>.yml)
    if (plan.themeConfig) {
      if (plan.themeConfig.added && plan.themeConfig.added.length) {
        writes.push({ kind: 'themeConfig', file: '_config.' + plan.themeConfig.theme + '.yml', action: 'append', label: '_config.' + plan.themeConfig.theme + '.yml — 追加 ' + plan.themeConfig.added.join(', ') + ' 段（主题配置）' });
      }
      if (plan.themeConfig.skipped && plan.themeConfig.skipped.length) {
        const l = '_config.' + plan.themeConfig.theme + '.yml — 跳过 ' + plan.themeConfig.skipped.join(', ') + ' 段（已存在，未覆盖）';
        writes.push({ kind: 'themeConfig', file: '_config.' + plan.themeConfig.theme + '.yml', action: 'skip', label: l }); skipped.push(l);
      }
    }
    return { ok: true, label: plan.recipe.label, desc: plan.recipe.desc, note: plan.recipe.note || '', writes: writes, skipped: skipped, conflicts: conflicts };
  }

  function planRecipe(blogPath, pkg) {
    const plan = computeRecipePlan(blogPath, pkg);
    if (!plan.ok) return plan;
    return summarizePlan(plan);
  }

  // 实际写入：_config.yml（config+permalink 一次写一次备份）、主题 inject、scripts、assets。
  // 已存在文件（冲突）一律跳过，绝不静默覆盖。
  function applyRecipe(blogPath, pkg) {
    const plan = computeRecipePlan(blogPath, pkg);
    if (!plan.ok) return plan;
    const summary = summarizePlan(plan);
    const applied = [];
    try {
      if (plan.configChanged) {
        const bak = backupFileIfExists(fsx, path.join(blogPath, '_config.yml'));
        fsx.writeFileSync(path.join(blogPath, '_config.yml'), plan.finalConfig, 'utf8');
        applied.push('_config.yml（备份：' + (bak || '新建') + '）');
      }
      if (plan.inject && plan.inject.theme && plan.inject.added && plan.inject.added.length) {
        const tbak = backupFileIfExists(fsx, plan.inject.file);
        fsx.writeFileSync(plan.inject.file, plan.inject.content, 'utf8');
        applied.push('_config.' + plan.inject.theme + '.yml inject（备份：' + (tbak || '新建') + '）');
      }
      // Theme config (themeConfig: per-theme settings)
      if (plan.themeConfig && plan.themeConfig.added && plan.themeConfig.added.length) {
        const tbak = backupFileIfExists(fsx, plan.themeConfig.file);
        fsx.writeFileSync(plan.themeConfig.file, plan.themeConfig.content, 'utf8');
        applied.push('_config.' + plan.themeConfig.theme + '.yml 主题配置（备份：' + (tbak || '新建') + '）');
      }
      for (let i = 0; i < plan.scripts.length; i++) {
        if (plan.scripts[i].exists) continue;
        const body = (plan.recipe.scripts[i] || {}).body || '';
        fsx.writeFileSync(plan.scripts[i].path, body, 'utf8');
        applied.push('scripts/' + plan.scripts[i].file);
      }
      for (let j = 0; j < plan.assets.length; j++) {
        if (plan.assets[j].exists) continue;
        const body = (plan.recipe.assets[j] || {}).body || '';
        fsx.writeFileSync(plan.assets[j].path, body, 'utf8');
        applied.push('source/' + plan.assets[j].file);
      }
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e), applied: applied, skipped: summary.skipped, conflicts: summary.conflicts };
    }
    const advice = (plan.scripts && plan.scripts.some(function (x) { return !x.exists; })) ? '提示：新建的 scripts/*.js 会在 hexo 启动时执行；请重启预览查看效果。' : '';
    return { ok: true, applied: applied, skipped: summary.skipped, conflicts: summary.conflicts, note: plan.recipe.note || '', advice: advice };
  }

  // Built-in theme names that cannot be deleted
  const PROTECTED_THEMES = new Set(['landscape']);

  function uninstallTheme(blogPath, theme) {
    requireBlogPath(blogPath);
    const name = String(theme || '').trim();
    if (!name) {
      const e = new Error('主题名称不能为空');
      e.code = 'EMPTY_THEME';
      throw e;
    }
    if (PROTECTED_THEMES.has(name)) {
      return { ok: false, error: `「${name}」是 Hexo 内置主题，不能删除。` };
    }
    // Check if npm-installed (in package.json dependencies)
    const pkg = readBlogPackageJson(fsx, blogPath);
    const npmName = name.startsWith('hexo-theme-') ? name : 'hexo-theme-' + name;
    if (pkg && pkg.dependencies && pkg.dependencies[npmName]) {
      const res = runNpm(blogPath, 'uninstall', npmName);
      return res && res.ok ? { ok: true, name: npmName }
        : { ok: false, error: (res && res.error) || '卸载失败', stderr: (res && res.stderr) || '' };
    }
    // Local theme: remove directory
    const themeDir = path.join(blogPath, 'themes', name);
    if (!fs.existsSync(themeDir)) {
      return { ok: false, error: '主题目录不存在：' + name };
    }
    try {
      // First try recursive remove
      fs.rmSync(themeDir, { recursive: true, force: true });
    } catch (e) {
      // Fallback: manually delete contents then directory
      try {
        const items = fs.readdirSync(themeDir);
        for (const item of items) {
          const itemPath = path.join(themeDir, item);
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemPath);
          }
        }
        fs.rmdirSync(themeDir);
      } catch (_) {
        return { ok: false, error: '删除失败，可能有文件被占用：' + name };
      }
    }
    return { ok: true, name };
  }

  return { listThemes, activateTheme, uninstallTheme, listPlugins, installPlugin, installTheme, uninstallPlugin,
           readBlogConfig, writeBlogConfig, readBlogConfigFile, writeBlogConfigFile, readThemeConfig, writeThemeConfig, readConfigBackup, listBlogConfigFiles, planRecipe, applyRecipe,
           listArchivedConfigs, archiveConfig, restoreArchivedConfig };
}

const _THEMES_EXPORTS = {
  createThemesService,
  parseActiveTheme,
  applyThemeLine,
  pluginCategory,
  listNpmPlugins,
  listNpmThemes,
  extractTopLevelKeys,
  parseTopLevelBlocks,
  mergeYamlSegment,
  mergeInjectItems,
  getScalarLine,
  applyScalarLine,
  archiveDir,
  listArchivedConfigs,
  archiveConfig,
  restoreArchivedConfig
};

module.exports = _THEMES_EXPORTS;


