'use strict';

/**
 * Scanner service — imports existing Hexo posts from a blog's
 * source/_posts/*.md into the app's posts store (PRD-minded enhancement).
 *
 * Pure Node.js, no Electron. Filesystem access is injectable (opts.fs) so the
 * parsing/import logic is unit-tested with an in-memory fake filesystem and a
 * fake posts store — exactly the injectable pattern used elsewhere (server's
 * createChild, deploy's spawn).
 *
 * YAML front-matter is parsed with a minimal hand-rolled parser that supports
 * the subset Hexo posts actually use (scalar, block list, inline list, boolean),
 * avoiding any extra dependency.
 */

const fs = require('fs');
const path = require('path');
const { stripQuotes } = require('./utils');

function nowIso() { return new Date().toISOString(); }

function normalizeDate(raw) {
  if (raw == null) return nowIso();
  const s = String(raw).trim();
  if (!s) return nowIso();
  // Already ISO (contains 'T' and a timezone-ish tail or 'Z')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s;
  // 'yyyy-MM-dd HH:mm:ss' common in Hexo posts
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(s);
  if (m) {
    const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0));
    return isNaN(dt.getTime()) ? s : dt.toISOString();
  }
  // bare date 'yyyy-MM-dd'
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (d) {
    const dt = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
    return isNaN(dt.getTime()) ? s : dt.toISOString();
  }
  // try Date fallback
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? s : dt.toISOString();
}

function parseInlineList(value) {
  const s = value.trim();
  if (!s) return [];
  if (s[0] === '[' && s[s.length - 1] === ']') {
    return s.slice(1, -1).split(',').map(x => stripQuotes(x)).filter(Boolean);
  }
  // single scalar value
  return [stripQuotes(s)];
}

/**
 * Parse a YAML front-matter block (the text between the leading --- fences)
 * into a plain object. Supports: key: value, key: [a, b], key: followed
 * by an indented - item block, and key: true/false. Unknown shapes keep the
 * raw trimmed string.
 */
function parseFrontMatterBlock(block) {
  const data = {};
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const knownList = ['tags', 'categories'];
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*#/.test(line) || line.trim() === '') { i++; continue; }
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1];
    let rest = m[2];
    if (rest === '') {
      // maybe a block list below: indented - item
      const list = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (/^\s*-\s+/.test(next)) {
          list.push(stripQuotes(next.replace(/^\s*-\s+/, '')));
          j++;
        } else if (next.trim() === '' || /^\s+#/.test(next)) { j++; }
        else break;
      }
      if (knownList.includes(key)) data[key] = list;
      else data[key] = list.length ? list : '';
      i = j;
    } else if (rest[0] === '[') {
      data[key] = parseInlineList(rest);
      i++;
    } else if (rest === 'true' || rest === 'false') {
      data[key] = (rest === 'true');
      i++;
    } else {
      data[key] = stripQuotes(rest);
      i++;
    }
  }
  return data;
}

/**
 * Split raw markdown into { data, body }. Returns null when there is no valid
 * opening front-matter fence.
 */
function parseFrontMatter(raw) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  return { data: parseFrontMatterBlock(m[1]), body: m[2] || '' };
}

function baseName(file) { return file.replace(/\.md$/i, ''); }

function createScannerService(posts, opts) {
  opts = opts || {};
  const fsx = opts.fs || fs;

  function scan(blogPath) {
    if (!blogPath) return { ok: false, error: '尚未配置博客本地路径，请先在设置中设置' };

    const dir = path.join(blogPath, 'source', '_posts');
    let files;
    try {
      files = fsx.readdirSync(dir);
    } catch (e) {
      return { ok: false, error: '无法读取文章目录 source/_posts：' + (e.message || e) };
    }

    const md = files.filter(function (f) { return /\.md$/i.test(f); });
    const scanned = [];
    const imported = [];
    const skipped = [];

    const seen = {};
    for (const p of posts.listPosts()) seen[p.title] = true;

    for (const f of md) {
      const full = path.join(dir, f);
      let raw;
      try {
        raw = fsx.readFileSync(full, 'utf8');
      } catch (e) {
        skipped.push({ file: f, reason: '读取失败：' + (e.message || e) });
        continue;
      }

      const fm = parseFrontMatter(raw);
      let title, date, tags, categories, content, status;

      if (fm) {
        const d = fm.data || {};
        title = d.title;
        date = d.date;
        tags = Array.isArray(d.tags) ? d.tags : (d.tags ? [d.tags] : []);
        categories = Array.isArray(d.categories) ? d.categories : (d.categories ? [d.categories] : []);
        content = fm.body;
        status = d.draft === true ? 'draft' : 'published';
      } else {
        content = raw;
        status = 'published';
      }
      if (!title) title = baseName(f);

      const item = {
        file: f,
        title: String(title),
        date: normalizeDate(date),
        tags: tags,
        categories: categories,
        status: status,
        content: content,
        source_file: f
      };
      scanned.push(item);

      if (seen[item.title]) {
        skipped.push({ file: f, title: item.title, reason: '标题已存在，已跳过' });
        continue;
      }
      const created = posts.createPost(item);
      seen[item.title] = true;
      imported.push(created);
    }

    return {
      ok: true,
      scanned: scanned.length,
      imported: imported.length,
      skipped: skipped,
      importedPosts: imported,
      scannedFiles: scanned,
      total: md.length
    };
  }

  return { scan };
}

module.exports = {
  createScannerService,
  parseFrontMatter,
  parseFrontMatterBlock,
  normalizeDate
};

