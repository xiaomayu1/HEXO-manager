const path = require('path');
const { slugify, frontMatterOf, buildMarkdown, postsDir, writePostFile, deletePostFile } = require('../src/core/syncHexo');

// 精简内存 fake fs（归一化 Windows/posix 路径拆分），只覆盖 syncHexo 用到的几个方法。
function norm(p) { return String(p == null ? '' : p).split('\\').join('/').replace(/\/+$/, ''); }
function makeFakeFs(seed) {
  const files = {};
  for (const k of Object.keys(seed || {})) files[norm(k)] = seed[k];
  return {
    readFileSync(full) { const n = norm(full); if (files[n] != null) return files[n]; const e = new Error('ENOENT ' + full); e.code = 'ENOENT'; throw e; },
    writeFileSync(full, c) { files[norm(full)] = String(c); },
    unlinkSync(full) { const n = norm(full); if (files[n] != null) { delete files[n]; return; } const e = new Error('ENOENT ' + full); e.code = 'ENOENT'; throw e; },
    mkdirSync() { },
    has(full) { return Object.prototype.hasOwnProperty.call(files, norm(full)); }
  };
}
const bp = 'B';

describe('syncHexo: drafts to _drafts, published to _posts', () => {
  test('postsDir defaults to _posts, isDraft=true -> _drafts', () => {
    expect(norm(postsDir(bp))).toBe('B/source/_posts');
    expect(norm(postsDir(bp, false))).toBe('B/source/_posts');
    expect(norm(postsDir(bp, true))).toBe('B/source/_drafts');
  });

  test('published post writes into _posts, not _drafts', () => {
    const fs = makeFakeFs({});
    const r = writePostFile({ fs }, bp, { source_file: 'a.md', title: 'A', status: 'published', content: 'x' });
    expect(r.ok).toBe(true);
    expect(r.dir).toBe('posts');
    expect(fs.has(path.join(bp, 'source', '_posts', 'a.md'))).toBe(true);
    expect(fs.has(path.join(bp, 'source', '_drafts', 'a.md'))).toBe(false);
  });

  test('draft post writes into _drafts, not _posts, with draft:true front-matter', () => {
    const fs = makeFakeFs({});
    const r = writePostFile({ fs }, bp, { source_file: 'b.md', title: 'B', status: 'draft', content: 'y' });
    expect(r.ok).toBe(true);
    expect(r.dir).toBe('drafts');
    const body = fs.readFileSync(path.join(bp, 'source', '_drafts', 'b.md'));
    expect(body).toContain('draft: true');
    expect(fs.has(path.join(bp, 'source', '_posts', 'b.md'))).toBe(false);
  });

  test('publishing a draft: same name moves _drafts -> _posts and clears the old draft file', () => {
    const fs = makeFakeFs({});
    writePostFile({ fs }, bp, { source_file: 'c.md', title: 'C', status: 'draft', content: 'z' });
    expect(fs.has(path.join(bp, 'source', '_drafts', 'c.md'))).toBe(true);
    // now flip to published (simulate clicking 发布)
    const r = writePostFile({ fs }, bp, { source_file: 'c.md', title: 'C', status: 'published', content: 'z' });
    expect(r.dir).toBe('posts');
    expect(fs.has(path.join(bp, 'source', '_posts', 'c.md'))).toBe(true);
    // cross-dir cleanup: _drafts copy removed so the draft no longer lingers
    expect(fs.has(path.join(bp, 'source', '_drafts', 'c.md'))).toBe(false);
  });

  test('un-publishing back to draft moves the file back _posts -> _drafts', () => {
    const fs = makeFakeFs({});
    writePostFile({ fs }, bp, { source_file: 'd.md', title: 'D', status: 'published', content: '' });
    writePostFile({ fs }, bp, { source_file: 'd.md', title: 'D', status: 'draft', content: '' });
    expect(fs.has(path.join(bp, 'source', '_drafts', 'd.md'))).toBe(true);
    expect(fs.has(path.join(bp, 'source', '_posts', 'd.md'))).toBe(false);
  });

  test('deletePostFile with status=draft removes the _drafts file and leaves _posts untouched', () => {
    const fs = makeFakeFs({});
    writePostFile({ fs }, bp, { source_file: 'e.md', title: 'E', status: 'draft', content: '' });
    const r = deletePostFile({ fs }, bp, 'e.md', 'draft');
    expect(r.ok).toBe(true);
    expect(r.deleted).toBe(true);
    expect(fs.has(path.join(bp, 'source', '_drafts', 'e.md'))).toBe(false);
  });

  test('deletePostFile without status only removes from _posts (back-compat with old callers)', () => {
    const fs = makeFakeFs({});
    writePostFile({ fs }, bp, { source_file: 'f.md', title: 'F', status: 'published', content: '' });
    const r = deletePostFile({ fs }, bp, 'f.md');
    expect(r.ok).toBe(true);
    expect(fs.has(path.join(bp, 'source', '_posts', 'f.md'))).toBe(false);
  });

  test('deletePostFile on a missing file returns skipped, not an error', () => {
    const fs = makeFakeFs({});
    const r = deletePostFile({ fs }, bp, 'nope.md', 'draft');
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  test('writePostFile skips when blog path or source_file missing', () => {
    const fs = makeFakeFs({});
    expect(writePostFile({ fs }, '', { source_file: 'x.md', status: 'draft' }).skipped).toBe(true);
    expect(writePostFile({ fs }, bp, { status: 'draft' }).skipped).toBe(true);
  });

  test('published front-matter has no draft:true line', () => {
    const fm = frontMatterOf({ title: 'T', status: 'published', tags: [], categories: [] });
    expect(fm).not.toContain('draft:');
  });
});