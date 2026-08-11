'use strict';

/**
 * Hexo 文件同步 —— 把应用里的文章按 Hexo 格式写进博客：
 *   status === 'draft'  → source/_drafts/<file>   （hexo server 默认不渲染 _drafts）
 *   其它（已发布/定时） → source/_posts/<file>     （hexo server 正常渲染）
 * 这样「在软件里保存草稿」不会让它出现在预览里；点「发布」后 status 变 published，
 * 文件被挪进 _posts/，预览才看到（方案 A，符合 Hexo 原生 _drafts 约定）。
 *
 * front-matter 仍按 status 写 `draft: true`（双重保险：即便 render_drafts 被打开、
 * 或文件被误挪进 _posts，Hexo 仍能识别草稿）。front-matter 与 scanner 解析对称。
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

// 草稿落 source/_drafts/，正式文章落 source/_posts/。isDraft 可省略（默认 false → _posts），
// 保持与旧调用 `postsDir(blogPath)` 完全兼容。
function postsDir(blogPath, isDraft) {
  return isDraft ? path.join(blogPath, 'source', '_drafts') : path.join(blogPath, 'source', '_posts');
}

// 按文章 status 选目录写盘；若该文件名在「另一目录」已存在（比如由 draft 转为 published 时
// _drafts 里还有旧版本），先删掉，避免同名文章在 _posts 和 _drafts 各残留一份。
function writePostFile(opts, blogPath, post) {
  const fsx = (opts && opts.fs) || require('fs');
  if (!blogPath) return { ok: false, skipped: true, reason: 'no blog path' };
  if (!post || !post.source_file) return { ok: false, skipped: true, reason: 'no source file' };
  const isDraft = post.status === 'draft';
  const dir = postsDir(blogPath, isDraft);
  try { fsx.mkdirSync(dir, { recursive: true }); } catch (_) {}
  // 跨目录清理：把另一目录里同名旧文件删掉（状态切换时挪窝，不留残桩）
  const otherDir = postsDir(blogPath, !isDraft);
  const otherFull = path.join(otherDir, post.source_file);
  try { fsx.unlinkSync(otherFull); } catch (e) { /* 不存在忽略 */ }
  const full = path.join(dir, post.source_file);
  try { fsx.writeFileSync(full, buildMarkdown(post), 'utf8'); }
  catch (e) { return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
  return { ok: true, file: post.source_file, path: full, dir: isDraft ? 'drafts' : 'posts' };
}

// 删除文章文件。status 可选：传 'draft' 删 _drafts/，其它删 _posts/；不传则只在 _posts/ 删
// （向后兼容旧调用 sync.deletePostFile({}, blogPath, fileName)）。
function deletePostFile(opts, blogPath, fileName, status) {
  const fsx = (opts && opts.fs) || require('fs');
  if (!blogPath || !fileName) return { ok: true, skipped: true };
  const isDraft = status === 'draft';
  const full = path.join(postsDir(blogPath, isDraft), fileName);
  try { fsx.unlinkSync(full); return { ok: true, deleted: true, file: fileName }; }
  catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, skipped: true, file: fileName };
    return { ok: false, error: (e && e.message) ? e.message : String(e) }; }
}

module.exports = { slugify, frontMatterOf, buildMarkdown, postsDir, writePostFile, deletePostFile };