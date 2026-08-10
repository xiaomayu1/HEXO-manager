const { createScannerService, parseFrontMatter, normalizeDate, stripQuotes } = require('../src/core/scanner');

const norm = p => (p == null ? '' : p).split('\\').join('/').replace(/\/+$/, '');

function makeFakePosts() {
  const list = [];
  return {
    listPosts: () => list.map(p => ({ ...p })),
    createPost: (input) => {
      const post = { id: list.length + 1, title: input.title, date: input.date, tags: input.tags, categories: input.categories, status: input.status, content: input.content };
      list.push(post);
      return post;
    }
  };
}

// Flat in-memory fs keyed by normalized realpath -> content. readdir lists direct children.
function makeFakeFs(files) {
  const store = {};
  for (const k of Object.keys(files)) store[norm(k)] = files[k];
  return {
    readdirSync(dir) {
      const base = norm(dir);
      const names = [];
      for (const full of Object.keys(store)) {
        if (full.indexOf(base + '/') === 0) {
          const rest = full.slice(base.length + 1);
          if (rest.indexOf('/') === -1) names.push(rest);
        }
      }
      if (!names.length && store[base] == null) {
        const e = new Error('ENOENT: ' + dir); e.code = 'ENOENT'; throw e;
      }
      return names;
    },
    readFileSync(full) {
      const n = norm(full);
      if (Object.prototype.hasOwnProperty.call(store, n)) return store[n];
      const e = new Error('ENOENT: ' + full); e.code = 'ENOENT'; throw e;
    }
  };
}

describe('scanner: front-matter parsing', () => {
  test('parseFrontMatter reads title/date/tags(block)/categories(inline)/draft', () => {
    const raw = '---\ntitle: Hello World\ndate: 2026-07-31 18:03:26\ntags:\n  - foo\n  - bar\ncategories: [tech, web]\ndraft: true\n---\n# Body\ncontent';
    const fm = parseFrontMatter(raw);
    expect(fm).not.toBeNull();
    expect(fm.data.title).toBe('Hello World');
    expect(fm.data.tags).toEqual(['foo', 'bar']);
    expect(fm.data.categories).toEqual(['tech', 'web']);
    expect(fm.data.draft).toBe(true);
    expect(fm.body).toContain('# Body');
  });

  test('parseFrontMatter handles quoted title and inline tags list', () => {
    const fm = parseFrontMatter('---\ntitle: "带 引号 的标题"\ntags: [a, b, c]\n---\nbody');
    expect(fm.data.title).toBe('带 引号 的标题');
    expect(fm.data.tags).toEqual(['a', 'b', 'c']);
  });

  test('parseFrontMatter returns null without a fence', () => {
    expect(parseFrontMatter('just markdown, no front matter')).toBeNull();
  });

  test('normalizeDate converts Hexo date formats to ISO', () => {
    expect(normalizeDate('2026-07-31 18:03:26')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(normalizeDate('2026-07-31')).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
    expect(normalizeDate('2026-07-31T18:03:26.000Z')).toBe('2026-07-31T18:03:26.000Z');
    expect(normalizeDate('')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('stripQuotes trims matching wrappers', () => {
    expect(stripQuotes('"abc"')).toBe('abc');
    expect(stripQuotes("'xyz'")).toBe('xyz');
    expect(stripQuotes('plain')).toBe('plain');
  });
});

describe('scanner: import service', () => {
  test('scan refuses without blog path', () => {
    const scanner = createScannerService(makeFakePosts());
    const r = scanner.scan('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/博客本地路径/);
  });

  test('scan reports missing _posts directory', () => {
    const scanner = createScannerService(makeFakePosts(), { fs: makeFakeFs({}) });
    const r = scanner.scan('E:/blog/hexo');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source\/_posts/);
  });

  test('scan imports new posts and skips duplicates by title', () => {
    const dupTitle = '你好aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const posts = makeFakePosts();
    posts.createPost({ title: dupTitle, date: '2026-01-01T00:00:00.000Z', tags: [], categories: [], status: 'published', content: '' });
    const fs = makeFakeFs({
      'E:/blog/hexo/source/_posts/dup.md': '---\ntitle: ' + dupTitle + '\ndate: 2026-07-31 18:03:26\ntags:\n---\n正文',
      'E:/blog/hexo/source/_posts/new.md': '---\ntitle: 新文章\ndate: 2026-08-01 12:00:00\ntags: [a, b]\ncategories: [tech]\n---\n# 新'
    });
    const scanner = createScannerService(posts, { fs });
    const r = scanner.scan('E:/blog/hexo');
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
    expect(r.imported).toBe(1);
    expect(r.skipped.map(s => s.title)).toContain(dupTitle);
    expect(posts.listPosts().length).toBe(2);
    const imported = posts.listPosts().find(p => p.title === '新文章');
    expect(imported.status).toBe('published');
    expect(imported.tags).toEqual(['a', 'b']);
  });

  test('scan uses filename as title when front-matter has no title', () => {
    const posts = makeFakePosts();
    const fs = makeFakeFs({ 'E:/blog/hexo/source/_posts/无标题.md': '这是一段没有 front-matter 的纯正文' });
    const scanner = createScannerService(posts, { fs });
    const r = scanner.scan('E:/blog/hexo');
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(1);
    expect(posts.listPosts()[0].title).toBe('无标题');
    expect(posts.listPosts()[0].status).toBe('published');
    expect(posts.listPosts()[0].content).toContain('纯正文');
  });
});
