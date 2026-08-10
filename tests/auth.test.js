const { createAuthService } = require('../src/core/auth');
const { openDatabase } = require('../src/core/db');
const { tmpDbPath } = require('./helpers');

// Fast bcrypt stub so the auth tests do not pay the real bcrypt cost; the real
// module (bcryptjs) is exercised in production. mirrors the injectable design
// documented in src/core/auth.js.
function fakeBcrypt() {
  return {
    hashSync: (pw) => 'H$' + pw,
    compareSync: (pw, hash) => hash === 'H$' + pw
  };
}

let db, auth;
beforeEach(() => {
  db = openDatabase(tmpDbPath('auth'));
  auth = createAuthService(db, { bcrypt: fakeBcrypt(), rounds: 4 });
});
afterEach(() => { try { db.close(); } catch (e) {} db = null; auth = null; });

describe('auth service (PRD 4.1 / 8 #1 — 登录/注册)', () => {
  test('registration creates a user and opens a session', () => {
    const u = auth.register({ username: 'alice', password: 'secret' });
    expect(u).toEqual({ id: expect.any(Number), username: 'alice' });
    expect(auth.currentUser()).toEqual({ id: u.id, username: 'alice' });
  });

  test('registration requires a username and a password', () => {
    expect(() => auth.register({ username: '', password: 'secret' })).toThrow(/用户名不能为空/);
    expect(() => auth.register({ username: 'bob', password: '' })).toThrow(/密码不能为空/);
  });

  test('registration enforces a minimum password length', () => {
    expect(() => auth.register({ username: 'bob', password: 'abc' })).toThrow(/密码至少需要 4 位/);
  });

  test('registration checks the confirmation password when provided', () => {
    expect(() => auth.register({ username: 'bob', password: 'secret', confirm: 'nope' })).toThrow(/两次输入的密码不一致/);
    expect(auth.register({ username: 'bob', password: 'secret', confirm: 'secret' }).username).toBe('bob');
  });

  test('duplicate usernames are rejected', () => {
    auth.register({ username: 'alice', password: 'secret' });
    auth.logout();
    expect(() => auth.register({ username: 'alice', password: 'secret' })).toThrow(/该用户名已被注册/);
  });

  test('login succeeds with the correct password and opens a session', () => {
    auth.register({ username: 'alice', password: 'secret' });
    auth.logout();
    const u = auth.login({ username: 'alice', password: 'secret' });
    expect(u.username).toBe('alice');
    expect(auth.currentUser().username).toBe('alice');
  });

  test('login fails with the wrong password without opening a session', () => {
    auth.register({ username: 'alice', password: 'secret' });
    auth.logout();
    expect(() => auth.login({ username: 'alice', password: 'wrong' })).toThrow(/用户名或密码错误/);
    expect(auth.currentUser()).toBeNull();
  });

  test('login fails for an unknown user', () => {
    expect(() => auth.login({ username: 'ghost', password: 'secret' })).toThrow(/用户名或密码错误/);
  });

  test('login requires username and password', () => {
    expect(() => auth.login({ username: '', password: 'secret' })).toThrow(/用户名不能为空/);
    expect(() => auth.login({ username: 'x', password: '' })).toThrow(/密码不能为空/);
  });

  test('logout clears the session and reports whether there was one', () => {
    expect(auth.logout()).toBe(false);
    auth.register({ username: 'alice', password: 'secret' });
    expect(auth.logout()).toBe(true);
    expect(auth.currentUser()).toBeNull();
  });

  test('listUsers returns public records without password hashes', () => {
    auth.register({ username: 'alice', password: 'secret' });
    auth.register({ username: 'bob', password: 'secret2' });
    const users = auth.listUsers();
    expect(users.length).toBe(2);
    expect(users.map(u => u.username)).toEqual(['alice', 'bob']);
    users.forEach(u => {
      expect(Object.keys(u).sort()).toEqual(['created_at', 'id', 'username']);
    });
  });

  test('count reports the registered user total', () => {
    expect(auth.count()).toBe(0);
    auth.register({ username: 'alice', password: 'secret' });
    expect(auth.count()).toBe(1);
    auth.register({ username: 'bob', password: 'secret2' });
    expect(auth.count()).toBe(2);
  });

  test('session is in-memory only: a fresh service starts logged out', () => {
    const p = tmpDbPath('auth-persist');
    const db1 = openDatabase(p);
    const a1 = createAuthService(db1, { bcrypt: fakeBcrypt(), rounds: 4 });
    a1.register({ username: 'alice', password: 'secret' });
    expect(a1.currentUser()).not.toBeNull();
    db1.close();
    const db2 = openDatabase(p);
    const a2 = createAuthService(db2, { bcrypt: fakeBcrypt(), rounds: 4 });
    expect(a2.currentUser()).toBeNull(); // no persisted session across a restart
    db2.close();
  });
});