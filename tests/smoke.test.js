const { DatabaseSync } = require('node:sqlite');
const { tmpDbPath } = require('./helpers');
test('smoke: jest and node:sqlite are wired up', () => {
  const db = new DatabaseSync(tmpDbPath());
  db.exec('CREATE TABLE t(x INTEGER)');
  db.prepare('INSERT INTO t VALUES (42)').run();
  expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
  db.close();
});
