/**
 * Media library service — stores uploaded images as base64 in SQLite.
 * Supports upload (dataUrl), list, get, delete.
 * Stores only the base64 payload + mime type; data URL is reconstructed on read.
 */
'use strict';

function createMediaService(db) {
  const stmtInsert = db.prepare(
    'INSERT INTO media (name, mime_type, size, base64, path, created_at) VALUES (?,?,?,?,?,?)'
  );
  const stmtGetById = db.prepare('SELECT * FROM media WHERE id=?');
  const stmtList = db.prepare(
    'SELECT id, name, mime_type, size, path, created_at FROM media ORDER BY created_at DESC'
  );
  const stmtGetFull = db.prepare(
    'SELECT * FROM media WHERE id=?'
  );
  const stmtDelete = db.prepare('DELETE FROM media WHERE id=?');

  function nowIso() { return new Date().toISOString(); }

  function rowToItem(row, includeData) {
    const item = {
      id: row.id, name: row.name, mime_type: row.mime_type,
      size: row.size || 0, path: row.path || '', created_at: row.created_at
    };
    if (includeData && row.base64) {
      item.data_url = row.mime_type
        ? 'data:' + row.mime_type + ';base64,' + row.base64
        : '';
    }
    return item;
  }

  function list() { return stmtList.all().map(rowToItem); }

  function get(id) {
    const row = stmtGetFull.get(Number(id));
    return row ? rowToItem(row, true) : null;
  }

  function add(input) {
    const i = input || {};
    let dataUrl = String(i.data_url || '');
    // If dataUrl is already plain base64, wrap it; otherwise parse it
    let mime = '';
    let b64 = '';
    if (dataUrl.startsWith('data:')) {
      const semi = dataUrl.indexOf(';');
      const comma = dataUrl.indexOf(',');
      mime = dataUrl.substring(5, semi > comma ? comma : semi);
      b64 = dataUrl.substring(comma + 1);
    } else {
      // plain base64 string — guess mime from input or default
      mime = String(i.mime_type || 'image/png');
      b64 = dataUrl;
    }
    if (!b64) throw new Error('no image data');
    const bytes = Buffer.from(b64, 'base64');
    const name = String(i.name || 'image').trim() || 'image_' + Date.now();
    const path = String(i.path || '');
    const createdAt = nowIso();
    const info = stmtInsert.run(name, mime, bytes.length, b64, path, createdAt);
    return get(info.lastInsertRowid);
  }

  function del(id) {
    const result = stmtDelete.run(Number(id));
    return result.changes > 0;
  }

  return { list, get, add, del };
}

module.exports = { createMediaService };
