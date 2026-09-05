'use strict';

/**
 * Hexo Market Service — search/browse/install Hexo themes & plugins from npm registry.
 *
 * Pure Node.js, no Electron. Uses built-in https/http + zlib only (zero new deps).
 * Supports configurable npm registry (default: official, with npmmirror fallback).
 *
 * Public API:
 *   - searchThemes(q, page, size)  → { ok, results, total }
 *   - searchPlugins(q, category, page, size)  → { ok, results, total }
 *   - getPackage(name)             → { ok, pkg, versions, githubStars }
 *   - downloadPackage(name, version, destDir, onProgress)  → { ok, path }
 *   - installTheme(name, version, blogPath, onProgress)    → { ok, name }
 *   - installPlugin(name, version, blogPath, onProgress)   → { ok, name }
 *   - getCachedStars()             → { [repo]: stars }  (used by renderer for sort display)
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---- Config constants ----
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CN_MIRROR = 'https://registry.npmmirror.com';
const CACHE_DIR_KEY = 'market_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GITHUB_CACHE_KEY = 'github_stars_cache';
const REQUEST_TIMEOUT_MS = 15000;

// ---- HTTP helpers ----

/**
 * Make an HTTPS GET request, returning a Promise that resolves with parsed JSON.
 * Auto-retry once on network error.
 */
function getJson(url, retries = 1) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      reject(new Error('请求超时（15s）'));
    }, REQUEST_TIMEOUT_MS);

    const req = mod.get(url, { headers: { 'User-Agent': 'HexoBlogManager/1.0' } }, (res) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        clearTimeout(timer);
        getJson(res.headers.location, retries).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON 解析失败')); }
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      if (retries > 0) {
        // Retry once with different timing
        setTimeout(() => getJson(url, retries - 1).then(resolve).catch(reject), 500);
      } else {
        reject(e);
      }
    });
  });
}

/**
 * Stream-download a URL to a file, calling onProgress(bytesWritten, total) each chunk.
 * Returns { ok, path } on success or { ok: false, error } on failure.
 */
function downloadStream(url, destPath, onProgress) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      // Clean up partial file
      try { fs.unlinkSync(destPath); } catch (_) {}
      resolve({ ok: false, error: '下载超时（15s）' });
    }, REQUEST_TIMEOUT_MS);

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const req = mod.get(url, { headers: { 'User-Agent': 'HexoBlogManager/1.0' } }, (res) => {
      clearTimeout(timer);
      if (timedOut) return;
      // Follow redirects (302 etc.)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        downloadStream(redirectUrl, destPath, onProgress).then(resolve).catch(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        resolve({ ok: false, error: `HTTP ${res.statusCode}` });
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let written = 0;
      const ws = fs.createWriteStream(destPath);
      ws.on('finish', () => resolve({ ok: true, path: destPath }));
      ws.on('error', (e) => {
        try { fs.unlinkSync(destPath); } catch (_) {}
        resolve({ ok: false, error: '写入失败: ' + e.message });
      });
      res.on('data', (chunk) => {
        written += chunk.length;
        if (onProgress) onProgress(written, total);
        ws.write(chunk);
      });
      res.on('end', () => {
        ws.end();
        if (written === 0) {
          try { fs.unlinkSync(destPath); } catch (_) {}
          resolve({ ok: false, error: '下载内容为空' });
        }
      });
      res.on('error', (e) => {
        try { ws.destroy(); fs.unlinkSync(destPath); } catch (_) {}
        resolve({ ok: false, error: e.message });
      });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      try { fs.unlinkSync(destPath); } catch (_) {}
      resolve({ ok: false, error: e.message });
    });
  });
}

// ---- Cache ----

function getCacheDir() {
  return path.join(os.homedir(), '.hexostudio', 'market_cache');
}

function readCache(key) {
  try {
    const p = path.join(getCacheDir(), key + '.json');
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      fs.unlinkSync(p);
      return null;
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

function writeCache(key, data) {
  try {
    const dir = getCacheDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify(data));
  } catch (_) {}
}

// ---- tar.gz extraction (pure JS, using zlib) ----

/**
 * Extract a .tar.gz buffer into destDir.
 * Returns { ok, extracted: number, error?: string }.
 */
function extractTarGz(tarBuf, destDir) {
  try {
    // Step 1: gunzip
    let data;
    try {
      data = zlib.gunzipSync(tarBuf);
    } catch (e) {
      // Some tgz files use deflate directly (gzip wrapper but no extra)
      try {
        data = zlib.inflateSync(tarBuf);
      } catch (e2) {
        return { ok: false, error: '解压失败：不是有效的 tar.gz 文件' };
      }
    }

    // Step 2: parse tar (512-byte blocks)
    const entries = parseTar(data);
    let extracted = 0;
    for (const entry of entries) {
      const targetPath = path.join(destDir, entry.name);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      if (entry.typeflag === '5' || entry.typeflag === '2') {
        // Directory entry (symlink target, skip)
        continue;
      }
      fs.writeFileSync(targetPath, entry.data);
      extracted++;
    }
    return { ok: true, extracted };
  } catch (e) {
    return { ok: false, error: '解压失败：' + e.message };
  }
}

/**
 * Minimal tar parser (GNU tar compatible).
 * Returns array of { name, data(Buffer), typeflag, size }.
 */
const TAR_BLOCK_SIZE = 512;

function parseTar(buf) {
  const entries = [];
  let pos = 0;

  while (pos < buf.length) {
    if (pos + TAR_BLOCK_SIZE > buf.length) break;

    const header = buf.slice(pos, pos + TAR_BLOCK_SIZE);
    // Two zero-filled blocks = EOF
    let allZero = true;
    for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    const name = parseTarFieldName(header);
    const size = parseTarNumber(header, 124, 12);
    if (size < 0 || size > buf.length - TAR_BLOCK_SIZE) break; // sanity check
    const typeflag = String.fromCharCode(header[156]);

    // Data follows immediately after the header block
    const dataStart = pos + TAR_BLOCK_SIZE;
    const dataLen = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    const dataEnd = dataStart + dataLen;
    if (dataEnd > buf.length) break; // truncated

    const data = buf.slice(dataStart, dataEnd);
    pos = dataEnd;

    entries.push({ name, data, typeflag, size });
  }
  return entries;
}

function parseTarFieldName(header) {
  // Check USTAR magic at bytes 257-262
  const magic = header.slice(257, 263).toString('utf8');
  // If magic is "ustar", there's no prefix — use name as-is
  if (magic !== 'ustar\0') {
    // Older GNU tar format: try prefix at bytes 157-263
    const prefixBytes = header.slice(157, 265);
    const prefix = prefixBytes.toString('utf8').replace(/\0/g, '').trim();
    let name = '';
    for (let i = 0; i < 100; i++) {
      if (header[i] === 0) break;
      name += String.fromCharCode(header[i]);
    }
    if (prefix) name = prefix + '/' + name;
    return name.trim();
  }
  // USTAR: full path is in bytes 0-99, no prefix
  let name = '';
  for (let i = 0; i < 100; i++) {
    if (header[i] === 0) break;
    name += String.fromCharCode(header[i]);
  }
  return name.trim();
}

function parseTarNumber(buf, offset, len) {
  // tar uses octal encoding (base-8), not binary
  let val = 0;
  for (let i = 0; i < len; i++) {
    const b = buf[offset + i];
    if (b === 0 || b === 32) break; // space or null = padding
    // Octal: each byte is a digit 0-7
    val = val * 8 + (b - 48); // '0' = 48
    if (val < 0 || !Number.isFinite(val)) break;
  }
  return val;
}

// ---- Version helpers ----

function safeGet(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

// ---- Package name normalization ----

function normalizePackageName(rawName) {
  rawName = (rawName || '').trim();
  return rawName;
}

// ---- Service factory ----

function createMarketService(opts) {
  opts = opts || {};
  const registryUrl = opts.registryUrl || DEFAULT_REGISTRY;
  const mirrorUrl = opts.mirrorUrl || CN_MIRROR;

  /**
   * Search npm registry for packages matching keywords.
   * Returns { ok, results: [{name, version, description, author, homepage, links}], total }
   */
  async function searchNpm(query, size = 20) {
    const encoded = encodeURIComponent(query);
    const url = `${registryUrl}/-/v1/search?text=${encoded}&size=${size}&offline=true`;
    try {
      const data = await getJson(url);
      const objects = data.objects || [];
      const results = objects.map(obj => {
        const pkg = obj.package;
        return {
          name: pkg.name || '',
          version: pkg.version || 'unknown',
          description: pkg.description || '',
          author: pkg.author ? (typeof pkg.author === 'string' ? pkg.author : (pkg.author.name || '')) : '',
          homepage: pkg.links && pkg.links.homepage ? pkg.links.homepage : '',
          githead: pkg.githead || '',
          date: pkg.date || '',
          keywords: pkg.keywords || []
        };
      });
      return { ok: true, results, total: data.total || 0 };
    } catch (e) {
      return { ok: false, error: '搜索失败：' + e.message };
    }
  }

  /**
   * Get package details from npm registry.
   * Returns { ok, name, description, versions: { [ver]: { date, disttar, dependencies } }, distTags }
   */
  async function getPackageDetails(name) {
    const url = `${registryUrl}/${name}`;
    try {
      const data = await getJson(url);
      const distTags = data['dist-tags'] || {};
      const versions = {};
      const verKeys = Object.keys(data.versions || {});
      for (const v of verKeys) {
        const verData = data.versions[v] || {};
        const tarballs = verData.dist || {};
        const tgzUrl = tarballs.tarball || '';
        const deps = verData.dependencies || {};
        versions[v] = {
          date: verData.time ? (verData.time[v] || '') : '',
          tarball: tgzUrl,
          dependencies: Object.keys(deps)
        };
      }
      return {
        ok: true,
        name,
        description: data.description || '',
        author: data.author ? (typeof data.author === 'string' ? data.author : (data.author.name || '')) : '',
        versions,
        distTags,
        homepage: data.homepage || '',
        github: data.github || ''
      };
    } catch (e) {
      return { ok: false, error: '获取详情失败：' + e.message };
    }
  }

  /**
   * Search for hexo themes (packages starting with hexo-theme-).
   * Also fetches GitHub stars via cache.
   */
  async function searchThemes(query, page = 0, size = 20) {
    // Search using the package name prefix for accurate matching
    const q = query
      ? `hexo-theme-${query}`
      : 'hexo-theme';
    const r = await searchNpm(q, size);
    if (!r.ok) return r;
    // Filter: ensure name starts with hexo-theme-
    const themes = r.results.filter(p => p.name.startsWith('hexo-theme-'));
    // Attach GitHub stars — always sync from cache to avoid flicker
    // Pre-fetch stars for any names not yet cached
    const stars = getCachedStars();
    const freshNames = themes.filter(t => !(t.name in stars)).map(t => t.name);
    if (freshNames.length) {
      try {
        const fetched = await fetchGitHubStars(freshNames);
        Object.assign(stars, fetched);
        writeCache(GITHUB_CACHE_KEY, { ...stars, _ts: Date.now() });
      } catch (_) { /* GitHub unavailable, keep zero values */ }
    }
    for (const t of themes) {
      t.stars = stars[t.name] || 0;
    }
    // Sort by relevance when query present, then by stars
    const sq = (query || '').trim().toLowerCase();
    const rel = sq ? (n => {
      const l = n.toLowerCase();
      if (l === 'hexo-theme-' + sq) return 3;
      if (l.startsWith('hexo-theme-' + sq)) return 2;
      if (l.includes(sq)) return 1;
      return 0;
    }) : null;
    if (sq) {
      themes.sort((a, b) => { const ra = rel(a.name), rb = rel(b.name); return ra !== rb ? rb - ra : (b.stars || 0) - (a.stars || 0); });
    } else {
      themes.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    }
    return { ok: true, results: themes, total: themes.length };
  }

  /**
   * Search for hexo plugins (exclude themes, filter by category).
   * Uses package-name-prefix search for accuracy.
   */
  async function searchPlugins(query, category, page = 0, size = 20) {
    // Build search query combining category + query for precise matching
    const parts = ['hexo'];
    if (category && category !== 'all') parts.push(category);
    if (query) parts.push(query);
    const searchQ = parts.join(' ');
    const r = await searchNpm(searchQ, size * 2);
    if (!r.ok) return r;

    // Filter: must start with hexo- but NOT hexo-theme-
    let results = r.results.filter(p =>
      p.name.startsWith('hexo-') && !p.name.startsWith('hexo-theme-')
    );

    if (category && category !== 'all') {
      results = results.filter(p =>
        p.name.startsWith('hexo-' + category + '-') ||
        p.name === 'hexo-' + category
      );
    }

    // Sort by relevance when query is present: exact match > contains > startsWith
    const q = (query || '').trim().toLowerCase();
    const rel = q ? (n => {
      const l = n.toLowerCase();
      if (l === 'hexo-' + q) return 3;
      if (l.startsWith('hexo-' + q)) return 2;
      if (l.includes(q)) return 1;
      return 0;
    }) : null;
    if (q) {
      results.sort((a, b) => { const ra = rel(a.name), rb = rel(b.name); return ra !== rb ? rb - ra : (b.stars || 0) - (a.stars || 0); });
    } else {
      results.sort((a, b) => (b.stars || 0) - (a.stars || 0));
    }

    // Pre-fetch stars for any names not yet cached
    const stars = getCachedStars();
    const freshNames = results.filter(p => !(p.name in stars)).map(p => p.name);
    if (freshNames.length) {
      try {
        const fetched = await fetchGitHubStars(freshNames);
        Object.assign(stars, fetched);
        writeCache(GITHUB_CACHE_KEY, { ...stars, _ts: Date.now() });
      } catch (_) { /* silently degrade */ }
    }
    for (const p of results) {
      p.stars = stars[p.name] || 0;
    }
    return { ok: true, results: results.slice(0, size), total: results.length };
  }

  /**
   * Download a package tgz to destDir, optionally with progress callback.
   */
  async function downloadPackage(name, version, destDir, onProgress) {
    const detail = await getPackageDetails(name);
    if (!detail.ok) return { ok: false, error: detail.error };

    const destPath = path.join(destDir, `${name}-${version}.tgz`);

    // Use the tarball URL directly from the API response when available
    const tgzUrl = (detail.versions && detail.versions[version] && detail.versions[version].tarball)
      || registryUrl + '/' + name + '/-/' + name.replace(/:/g, '%3A') + '-' + version + '.tgz';
    const mirrorTgzUrl = mirrorUrl + '/' + name + '/-/' + name.replace(/:/g, '%3A') + '-' + version + '.tgz';

    // 优先尝试官方源，失败再尝试镜像（镜像有时返回 302 导致下载失败）
    let r = await downloadStream(tgzUrl, destPath, onProgress);
    if (!r.ok) {
      r = await downloadStream(mirrorTgzUrl, destPath, onProgress);
      if (!r.ok) return { ok: false, error: `下载失败（官方源和镜像均不可用：${r.error}）` };
    }
    return r;
  }

  /**
   * Install a theme: download tgz, extract, move into blogPath/themes/<themeName>.
   * Returns { ok, name, note }
   */
  async function installTheme(name, version, blogPath, onProgress) {
    if (!blogPath) return { ok: false, error: '未配置博客本地路径' };
    const themesDir = path.join(blogPath, 'themes');
    if (!fs.existsSync(themesDir)) {
      fs.mkdirSync(themesDir, { recursive: true });
    }

    // Download to a temp dir within the blog's themes folder (same drive to avoid cross-device rename)
    const dlDir = path.join(themesDir, '.market_tmp_' + Date.now());
    const dlResult = await downloadPackage(name, version, dlDir, onProgress);
    if (!dlResult.ok) return { ok: false, error: dlResult.error };

    // Extract
    const tgzBuf = fs.readFileSync(dlResult.path);
    const extractDir = path.join(dlDir, '_extracted');
    const extractResult = extractTarGz(tgzBuf, extractDir);
    fs.unlinkSync(dlResult.path); // cleanup tgz
    if (!extractResult.ok) return { ok: false, error: extractResult.error };

    // Find the package directory inside extracted (it's usually package/ or name/)
    const extractedDir = extractDir;
    let pkgDir = null;
    // Try common patterns
    const candidates = [
      path.join(extractedDir, 'package'),
      path.join(extractedDir, name),
      path.join(extractedDir, name.replace('hexo-theme-', '')),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        pkgDir = c;
        break;
      }
    }
    if (!pkgDir) {
      // Fall back to first subdirectory
      const items = fs.readdirSync(extractedDir);
      for (const item of items) {
        const fullPath = path.join(extractedDir, item);
        if (fs.statSync(fullPath).isDirectory()) {
          pkgDir = fullPath;
          break;
        }
      }
    }

    if (!pkgDir) return { ok: false, error: '无法定位包内容目录' };

    // Move to themes/<name> (use copy+delete for cross-drive support)
    const themeDest = path.join(themesDir, name);
    if (fs.existsSync(themeDest)) {
      // Remove existing
      fs.rmSync(themeDest, { recursive: true, force: true });
    }
    fs.cpSync(pkgDir, themeDest, { recursive: true });
    fs.rmSync(pkgDir, { recursive: true, force: true });

    // Copy theme's _config.yml to blog root as _config.<theme>.yml if not exists
    // Theme name for config file: strip 'hexo-theme-' prefix if present
    const themeCfgName = name.startsWith('hexo-theme-') ? name.slice('hexo-theme-'.length) : name;
    const srcConfig = path.join(themeDest, '_config.yml');
    const dstConfig = path.join(blogPath, '_config.' + themeCfgName + '.yml');
    if (fs.existsSync(srcConfig) && !fs.existsSync(dstConfig)) {
      fs.copyFileSync(srcConfig, dstConfig);
    }

    // Cleanup
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(dlDir, { recursive: true, force: true }); } catch (_) {}

    return {
      ok: true,
      name,
      note: `主题 ${name} 已安装到 themes/${name}，请在 _config.yml 中设置 theme: ${name}`
    };
  }

  /**
   * Install a plugin via npm (the standard way).
   * Returns { ok, name }
   */
  async function installPlugin(name, version, blogPath, onProgress) {
    if (!blogPath) return { ok: false, error: '未配置博客本地路径' };
    const fullName = name.startsWith('hexo-') ? name : `hexo-${name}`;
    try {
      const r = spawnSync('npm', ['install', '--save', fullName], {
        cwd: blogPath,
        timeout: 180000,
        encoding: 'utf8',
        shell: true
      });
      if (r.error) {
        return { ok: false, error: '无法执行 npm，请确认已安装 Node.js：https://nodejs.org' };
      }
      if (r.status !== 0) {
        return { ok: false, error: `npm 安装失败（退出码 ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 300)}` };
      }
      return { ok: true, name: fullName };
    } catch (e) {
      return { ok: false, error: `npm 安装失败：${e.message}` };
    }
  }

  /**
   * Look up GitHub stars for a package name (uses cache).
   */
  function lookupStars(packageName) {
    const stars = getCachedStars();
    return stars[packageName] || 0;
  }

  /**
   * Fetch GitHub stars for the current search results (writes cache).
   */
  async function fetchGitHubStars(packageNames) {
    const uniqueNames = [...new Set(packageNames.filter(Boolean))];
    if (!uniqueNames.length) return {};

    const cached = readCache(GITHUB_CACHE_KEY);
    const now = Date.now();
    const result = {};
    const stale = {};

    // Fill from cache first
    for (const name of uniqueNames) {
      if (cached && cached[name] && (now - cached[name]._ts < CACHE_TTL_MS)) {
        result[name] = cached[name].stars;
      } else {
        stale[name] = true;
      }
    }

    // Fetch all at once via batched OR queries to avoid rate limits
    if (Object.keys(stale).length) {
      try {
        const batchSize = 5;
        for (let i = 0; i < uniqueNames.length; i += batchSize) {
          const batch = uniqueNames.slice(i, i + batchSize);
          const q = encodeURIComponent(batch.join(' OR ') + ' in:name');
          const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=100`;
          const data = await getJson(url);
          const items = data.items || [];
          for (const pkgName of batch) {
            // Match by exact repo name (e.g. hexojs/hexo-util matches hexo-util)
            const exact = items.find(it => it.name === pkgName);
            result[pkgName] = exact ? (exact.stargazers_count || 0) : 0;
          }
        }
      } catch (_) { /* silently degrade */ }
    }

    // Write updated cache — flat object { [name]: stars } + timestamp key
    const cacheData = { _ts: now };
    for (const [k, v] of Object.entries(result)) {
      cacheData[k] = v;
    }
    writeCache(GITHUB_CACHE_KEY, cacheData);

    return result;
  }

  function getCachedStars() {
    try {
      const cached = readCache(GITHUB_CACHE_KEY);
      if (!cached || !cached._ts) return {};
      if (Date.now() - cached._ts > CACHE_TTL_MS) {
        try { fs.unlinkSync(path.join(getCacheDir(), GITHUB_CACHE_KEY + '.json')); } catch (_) {}
        return {};
      }
      const out = {};
      for (const [k, v] of Object.entries(cached)) {
        if (k !== '_ts' && typeof v === 'number') {
          out[k] = v;
        }
      }
      return out;
    } catch (_) { return {}; }
  }

  // Mutable registry URL (stored externally via settings)
  let _registryUrl = registryUrl;
  function setRegistryUrl(url) {
    _registryUrl = String(url || '').trim() || registryUrl;
    // Also update mirror URL to match the new registry base
    if (!url || !url.trim()) {
      mirrorUrl = CN_MIRROR;
    } else {
      mirrorUrl = _registryUrl.replace('registry.npmjs.org', 'registry.npmmirror.com')
                           .replace('https://registry.npmjs.org', 'https://registry.npmmirror.com');
    }
  }
  function getRegistryUrl() { return _registryUrl; }

  return {
    searchThemes,
    searchPlugins,
    getPackageDetails,
    downloadPackage,
    installTheme,
    installPlugin,
    fetchGitHubStars,
    getCachedStars,
    lookupStars,
    setRegistryUrl,
    getRegistryUrl,
    registryUrl: () => _registryUrl,
    mirrorUrl
  };
}

module.exports = {
  createMarketService,
  extractTarGz,
  parseTar,
  getCacheDir,
  normalizePackageName
};
