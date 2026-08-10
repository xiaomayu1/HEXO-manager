/**
 * Posts service — CRUD, search, status filter (PRD 4.2 / 8).
 * tags & categories stored as JSON arrays; statuses: published/draft/scheduled.
 */
'use strict';

const { slugify } = require('./syncHexo');

const VALID_STATUSES = ['published', 'draft', 'scheduled'];

function createPostsService(db) {
  const stmtInsert = db.prepare(
    `INSERT INTO posts (title, date, tags, categories, status, content, source_file, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  );
  const stmtUpdate = db.prepare(
    `UPDATE posts SET title=?, date=?, tags=?, categories=?, status=?, content=?, source_file=?, updated_at=?
     WHERE id=?`
  );
  const stmtGetById = db.prepare('SELECT * FROM posts WHERE id=?');
  const stmtSoftDelete = db.prepare('UPDATE posts SET deleted_at=?, updated_at=? WHERE id=?');
  const stmtListActive = db.prepare(
    `SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY datetime(date) DESC, id DESC`
  );
  const stmtSearch = db.prepare(
    `SELECT * FROM posts
     WHERE deleted_at IS NULL AND title LIKE ?
     ORDER BY datetime(date) DESC, id DESC`
  );
  const stmtFilter = db.prepare(
    `SELECT * FROM posts
     WHERE deleted_at IS NULL AND status=?
     ORDER BY datetime(date) DESC, id DESC`
  );

  function nowIso() { return new Date().toISOString(); }

  function toPublic(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      date: row.date,
      tags: JSON.parse(row.tags || '[]'),
      categories: JSON.parse(row.categories || '[]'),
      status: row.status,
      content: row.content,
      source_file: row.source_file || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted: row.deleted_at != null
    };
  }

  function normalizeInput(input) {
    input = input || {};
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) {
      const e = new Error('标题不能为空');
      e.code = 'EMPTY_TITLE';
      throw e;
    }
    const status = VALID_STATUSES.includes(input.status) ? input.status : 'draft';
    const sourceFile = (input.source_file && String(input.source_file).trim())
      || (slugify(title) + '.md');
    return {
      title,
      date: input.date || nowIso(),
      tags: Array.isArray(input.tags) ? input.tags : (input.tags ? [input.tags] : []),
      categories: Array.isArray(input.categories)
        ? input.categories
        : (input.categories ? [input.categories] : []),
      status,
      content: input.content || '',
      source_file: sourceFile
    };
  }

  function createPost(input) {
    const data = normalizeInput(input);
    const createdAt = nowIso();
    const info = stmtInsert.run(
      data.title,
      data.date,
      JSON.stringify(data.tags),
      JSON.stringify(data.categories),
      data.status,
      data.content,
      data.source_file,
      createdAt,
      createdAt
    );
    return toPublic(stmtGetById.get(info.lastInsertRowid));
  }

  function updatePost(id, input) {
    const existing = stmtGetById.get(id);
    if (!existing || existing.deleted_at) return null;
    const data = normalizeInput(input);
    stmtUpdate.run(
      data.title,
      data.date,
      JSON.stringify(data.tags),
      JSON.stringify(data.categories),
      data.status,
      data.content,
      data.source_file,
      nowIso(),
      id
    );
    return toPublic(stmtGetById.get(id));
  }

  function deletePost(id) {
    const existing = stmtGetById.get(id);
    if (!existing || existing.deleted_at) return false;
    stmtSoftDelete.run(nowIso(), nowIso(), id);
    return true;
  }

  function getPost(id) { return toPublic(stmtGetById.get(id)); }
  function listPosts() { return stmtListActive.all().map(toPublic); }

  function searchPosts(query) {
    const q = (query == null ? '' : String(query)).trim();
    if (!q) return listPosts();
    return stmtSearch.all('%' + q + '%').map(toPublic);
  }

  function filterByStatus(status) {
    if (!VALID_STATUSES.includes(status)) {
      const e = new Error('invalid status: ' + status);
      e.code = 'INVALID_STATUS';
      throw e;
    }
    return stmtFilter.all(status).map(toPublic);
  }

  return {
    createPost, updatePost, deletePost, getPost,
    listPosts, searchPosts, filterByStatus, VALID_STATUSES
  };
}

module.exports = { createPostsService, VALID_STATUSES, slugify };
