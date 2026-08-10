/**
 * Auth service (PRD 4.1 / 8 #1) — local multi-user login / registration.
 * Passwords are stored as bcrypt hashes (never plaintext). A volatile session
 * holds the currently logged-in user; it is not persisted, so every app launch
 * starts at the login screen. bcrypt is injectable via opts.bcrypt so the unit
 * tests can run a fast stub, and opts.rounds controls the bcrypt cost.
 *
 * Profile editing (display name / bio / username rename) and password change
 * operate on the logged-in session; the features are additive and do not alter
 * the original login/register/logout behavior.
 */
'use strict';

const bcrypt = require('bcryptjs');

function createAuthService(db, opts) {
  const lib = (opts && opts.bcrypt) || bcrypt;
  const rounds = (opts && opts.rounds) || 10;

  const stmtByUsername = db.prepare('SELECT * FROM users WHERE username=?');
  const stmtById = db.prepare('SELECT * FROM users WHERE id=?');
  const stmtInsert = db.prepare(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)'
  );
  const stmtAll = db.prepare('SELECT id, username, created_at FROM users ORDER BY id');

  let session = null;

  function fail(code, msg) {
    const e = new Error(msg);
    e.code = code;
    return e;
  }

  function publicUser(row) {
    return { id: row.id, username: row.username, display_name: row.display_name || '', bio: row.bio || '', created_at: row.created_at };
  }

  function register(input) {
    const i = input || {};
    const username = String(i.username || '').trim();
    const password = i.password == null ? '' : String(i.password);
    if (!username) throw fail('USERNAME_REQUIRED', '用户名不能为空');
    if (!password) throw fail('PASSWORD_REQUIRED', '密码不能为空');
    if (password.length < 4) throw fail('PASSWORD_TOO_SHORT', '密码至少需要 4 位');
    if (i.confirm != null && String(i.confirm) !== password) {
      throw fail('PASSWORD_MISMATCH', '两次输入的密码不一致');
    }
    if (stmtByUsername.get(username)) throw fail('USERNAME_EXISTS', '该用户名已被注册');
    const hash = lib.hashSync(password, rounds);
    const res = stmtInsert.run(username, hash, new Date().toISOString());
    const row = stmtById.get(res.lastInsertRowid);
    session = { id: row.id, username: row.username };
    return publicUser(row);
  }

  function login(input) {
    const i = input || {};
    const username = String(i.username || '').trim();
    const password = i.password == null ? '' : String(i.password);
    if (!username) throw fail('USERNAME_REQUIRED', '用户名不能为空');
    if (!password) throw fail('PASSWORD_REQUIRED', '密码不能为空');
    const row = stmtByUsername.get(username);
    if (!row || !lib.compareSync(password, row.password_hash)) {
      throw fail('INVALID_CREDENTIALS', '用户名或密码错误');
    }
    session = { id: row.id, username: row.username };
    return publicUser(row);
  }

  function logout() {
    const had = !!session;
    session = null;
    return had;
  }

  function currentUser() {
    return session ? Object.assign({}, session) : null;
  }

  function listUsers() {
    return stmtAll.all();
  }

  function count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  // ---- Profile editing (additive; operates on the logged-in session) ----
  const stmtUpdateProfile = db.prepare(
    'UPDATE users SET display_name=?, bio=? WHERE id=?'
  );
  const stmtRename = db.prepare('UPDATE users SET username=? WHERE id=?');
  const stmtUpdatePassword = db.prepare('UPDATE users SET password_hash=? WHERE id=?');

  function getProfile() {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    const row = stmtById.get(session.id);
    if (!row) throw fail('USER_NOT_FOUND', '用户不存在');
    return publicUser(row);
  }

  function updateProfile(input) {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    const i = input || {};
    const displayName = String(i.display_name == null ? '' : i.display_name).slice(0, 60);
    const bio = String(i.bio == null ? '' : i.bio).slice(0, 280);
    let username = String(i.username == null ? '' : i.username).trim();
    if (username && username !== session.username) {
      if (stmtByUsername.get(username)) throw fail('USERNAME_EXISTS', '该用户名已被注册');
      stmtRename.run(username, session.id);
      session.username = username;
    } else {
      username = session.username;
    }
    stmtUpdateProfile.run(displayName, bio, session.id);
    const row = stmtById.get(session.id);
    return publicUser(row);
  }

  function changePassword(input) {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    const i = input || {};
    const oldPassword = i.old_password == null ? '' : String(i.old_password);
    const newPassword = i.new_password == null ? '' : String(i.new_password);
    if (!oldPassword) throw fail('PASSWORD_REQUIRED', '请输入当前密码');
    if (!newPassword) throw fail('PASSWORD_REQUIRED', '请输入新密码');
    if (newPassword.length < 4) throw fail('PASSWORD_TOO_SHORT', '密码至少需要 4 位');
    const row = stmtById.get(session.id);
    if (!row || !lib.compareSync(oldPassword, row.password_hash)) {
      throw fail('INVALID_CREDENTIALS', '当前密码不正确');
    }
    const hash = lib.hashSync(newPassword, rounds);
    stmtUpdatePassword.run(hash, session.id);
    return { ok: true };
  }

  return { register, login, logout, currentUser, listUsers, count, getProfile, updateProfile, changePassword };
}

module.exports = { createAuthService };
