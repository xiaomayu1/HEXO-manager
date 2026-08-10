const { createPostsService } = require('../src/core/posts');
const { makeDb } = require('./helpers');

let db, posts;
beforeEach(() => {
  db = makeDb('posts');
  posts = createPostsService(db);
});
afterEach(() => { db.close(); db = null; posts = null; });

describe('posts service (Phase 3)', () => {
  test('create a published post with tags and content', () => {
    const p = posts.createPost({
      title: '第一篇', content: '# Hello', status: 'published',
      tags: ['hexo', 'note'], categories: ['blog']
    });
    expect(p.id).toBeGreaterThan(0);
    expect(p.title).toBe('第一篇');
    expect(p.content).toBe('# Hello');
    expect(p.status).toBe('published');
    expect(p.tags).toEqual(['hexo', 'note']);
    expect(p.categories).toEqual(['blog']);
    expect(p.deleted).toBe(false);
  });

  test('new post with no status defaults to draft', () => {
    const p = posts.createPost({ title: '草稿' });
    expect(p.status).toBe('draft');
  });

  test('empty title is rejected', () => {
    expect(() => posts.createPost({ title: '   ' })).toThrow(/标题/);
    expect(() => posts.createPost({})).toThrow(/标题/);
  });

  test('newly created post appears in the list (PRD 8 #6)', () => {
    posts.createPost({ title: '出现吧', status: 'published' });
    const list = posts.listPosts();
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('出现吧');
  });

  test('list ordering: newest date first', () => {
    posts.createPost({ title: 'old', date: '2024-01-01T00:00:00Z' });
    posts.createPost({ title: 'new', date: '2026-01-01T00:00:00Z' });
    posts.createPost({ title: 'mid', date: '2025-01-01T00:00:00Z' });
    const titles = posts.listPosts().map(p => p.title);
    expect(titles).toEqual(['new', 'mid', 'old']);
  });

  test('edit an existing post and persist changes (PRD 8 #4)', () => {
    const created = posts.createPost({ title: '原标题', content: 'A', status: 'draft' });
    const updated = posts.updatePost(created.id, { title: '新标题', content: 'B', status: 'published' });
    expect(updated).not.toBeNull();
    expect(updated.title).toBe('新标题');
    expect(updated.content).toBe('B');
    expect(updated.status).toBe('published');
    expect(updated.id).toBe(created.id);
    expect(updated.updated_at).not.toBe(created.updated_at);
  });

  test('update on non-existent / deleted post returns null', () => {
    expect(posts.updatePost(99999, { title: 'x' })).toBeNull();
    const p = posts.createPost({ title: 'del' });
    posts.deletePost(p.id);
    expect(posts.updatePost(p.id, { title: 'again' })).toBeNull();
  });

  test('delete hides the post from list (PRD 8 #5)', () => {
    const p = posts.createPost({ title: '删除我' });
    expect(posts.listPosts().length).toBe(1);
    expect(posts.deletePost(p.id)).toBe(true);
    expect(posts.listPosts().length).toBe(0);
  });

  test('delete is idempotent-safe: second delete returns false', () => {
    const p = posts.createPost({ title: 'x' });
    expect(posts.deletePost(p.id)).toBe(true);
    expect(posts.deletePost(p.id)).toBe(false);
  });

  test('search by title substring is case-insensitive', () => {
    posts.createPost({ title: 'Hexo 教程' });
    posts.createPost({ title: '日常记录' });
    expect(posts.searchPosts('hexo').map(p => p.title)).toEqual(['Hexo 教程']);
    expect(posts.searchPosts('记录').length).toBe(1);
    expect(posts.searchPosts('').length).toBe(2);
  });

  test('filter by status returns only matching posts', () => {
    posts.createPost({ title: 'a', status: 'published' });
    posts.createPost({ title: 'b', status: 'draft' });
    posts.createPost({ title: 'c', status: 'published' });
    expect(posts.filterByStatus('published').length).toBe(2);
    expect(posts.filterByStatus('draft').length).toBe(1);
    expect(posts.filterByStatus('scheduled').length).toBe(0);
  });

  test('filter rejects an invalid status', () => {
    expect(() => posts.filterByStatus('foobar')).toThrow();
  });

  test('tags and categories round-trip as arrays', () => {
    const p = posts.createPost({ title: 't', tags: ['a', 'b'], categories: ['cat1'] });
    const fetched = posts.getPost(p.id);
    expect(Array.isArray(fetched.tags)).toBe(true);
    expect(fetched.tags).toEqual(['a', 'b']);
    expect(fetched.categories).toEqual(['cat1']);
  });

  test('getPost returns the stored post by id', () => {
    const p = posts.createPost({ title: '查找', content: 'C' });
    expect(posts.getPost(p.id).content).toBe('C');
  });
});
