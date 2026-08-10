'use strict';

/**
 * Hexo 文件同步 —— 把应用里的文章按 Hexo 格式写成 source/_posts/*.md，
 * 删除时删对应文件。front-matter 与 scanner 的解析对称，重新扫描可读回。
 *
 * 仅副作用在可控文件目录下；模块纯函数（slug/frontMatter/buildMarkdown）
 * 不依赖 fs，便于单测；写盘/删盘注入 fs/path（默认用真实模块）。
 */
const path = require('path');

function slugify(title) {
  let s = String(title == null ? '' : title).trim();
  if (!s) return 'untitled';
  s = s.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ''); // 去掉文件系统非法字符
  s = s.replace(/\s+/g, '-');                       // 空格 → -
  s = s.replace(/\.+/g, '.');                       // 折叠连续点
  s = s.replace(/-+/g, '-');                        // 折叠连续 -
  s = s.replace(/^[-.]+|[-.]+$/g, '');              // 去首尾 -. 
  if (!s) s = 'untitled';
  return s;
}

function frontMatterOf(post) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const cats = Array.isArray(post.categories) ? post.categories : [];
  const lines = [
    '---',
    'title: ' + String(post.title == null ? '' : post.title),
    'date: ' + String(post.date == null ? '' : post.date)
  ];
  lines.push('tags:' + (tags.length ? '\n' + tags.map(t => '  - ' + String(t).replace(/\n/g, ' ')).join('\n') : ' []'));
  lines.push('categories:' + (cats.length ? '\n' + cats.map(c => '  - ' + String(c).replace(/\n/g, ' ')).join('\n') : ' []'));
  if (post.status === 'draft') lines.push('draft: true');
  lines.push('---');
  return lines.join('\n');
}

function buildMarkdown(post) {
  return frontMatterOf(post) + '\n\n' + String(post.content == null ? '' : post.content).replace(/\r\n/g, '\n');
}

function postsDir(blogPath) { return path.join(blogPath, 'source', '_posts'); }

function writePostFile(opts, blogPath, post) {
  const fsx = (opts && opts.fs) || require('fs');
  if (!blogPath) return { ok: false, skipped: true, reason: 'no blog path' };
  if (!post || !post.source_file) return { ok: false, skipped: true, reason: 'no source file' };
  const dir = postsDir(blogPath);
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const full = path.join(dir, post.source_file);
  try { fsx.writeFileSync(full, buildMarkdown(post), 'utf8'); }
  catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  return { ok: true, file: post.source_file, path: full };
}

function deletePostFile(opts, blogPath, fileName) {
  const fsx = (opts && opts.fs) || require('fs');
  if (!blogPath || !fileName) return { ok: true, skipped: true };
  const full = path.join(blogPath, 'source', '_posts', fileName);
  try { fsx.unlinkSync(full); return { ok: true, deleted: true, file: fileName }; }
  catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, skipped: true, file: fileName };
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

module.exports = { slugify, frontMatterOf, buildMarkdown, postsDir, writePostFile, deletePostFile };
