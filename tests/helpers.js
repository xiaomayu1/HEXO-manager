// Shared test helpers
const os = require('os');
const fs = require('fs');
const path = require('path');
const { openDatabase } = require('../src/core/db');

function tmpDbPath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'hbm-test') + '-'));
  return path.join(dir, 'data.sqlite3');
}

// Returns a fresh migrated db for a test. Caller must close it (or use makeDbSvc).
function makeDb(prefix) {
  return openDatabase(tmpDbPath(prefix));
}

module.exports = { tmpDbPath, makeDb };
