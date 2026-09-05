/**
 * Notice service — CRUD for software announcements displayed on the dashboard.
 */
'use strict';

function createNoticeService(db) {
  const stmtInsert = db.prepare(
    'INSERT INTO notices (title, content, priority, created_at, updated_at) VALUES (?,?,?,?,?)'
  );
  const stmtUpdate = db.prepare(
    'UPDATE notices SET title=?, content=?, priority=?, updated_at=? WHERE id=?'
  );
  const stmtDelete = db.prepare('DELETE FROM notices WHERE id=?');
  const stmtGetById = db.prepare('SELECT * FROM notices WHERE id=?');
  const stmtList = db.prepare(
    'SELECT * FROM notices ORDER BY priority ASC, created_at DESC'
  );

  function nowIso() { return new Date().toISOString(); }

  function list() { return stmtList.all().map(row => ({
    id: row.id, title: row.title, content: row.content,
    priority: row.priority || 'normal',
    created_at: row.created_at, updated_at: row.updated_at
  })); }

  function get(id) {
    const row = stmtGetById.get(Number(id));
    if (!row) return null;
    return {
      id: row.id, title: row.title, content: row.content,
      priority: row.priority || 'normal',
      created_at: row.created_at, updated_at: row.updated_at
    };
  }

  function add(input) {
    const i = input || {};
    const title = String(i.title || '').trim();
    if (!title) throw new Error('标题不能为空');
    const content = String(i.content || '');
    const priority = ['high', 'medium', 'normal'].includes(i.priority) ? i.priority : 'normal';
    const now = nowIso();
    const info = stmtInsert.run(title, content, priority, now, now);
    return get(info.lastInsertRowid);
  }

  function update(id, input) {
    const existing = stmtGetById.get(Number(id));
    if (!existing) return null;
    const i = input || {};
    const title = String(i.title || '').trim();
    if (!title) throw new Error('标题不能为空');
    const content = String(i.content || '');
    const priority = ['high', 'medium', 'normal'].includes(i.priority) ? i.priority : existing.priority;
    stmtUpdate.run(title, content, priority, nowIso(), Number(id));
    return get(Number(id));
  }

  function del(id) {
    const result = stmtDelete.run(Number(id));
    return result.changes > 0;
  }

  return { list, get, add, update, del };
}

module.exports = { createNoticeService };
