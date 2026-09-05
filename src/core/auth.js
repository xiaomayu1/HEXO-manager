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

  // ---- OAuth account binding ----
  const OAUTH_PROVIDERS = ['github', 'gitee'];
  const OAUTH_CONFIG = {
    github: {
      authorizeUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      scopes: 'read:user user:email'
    },
    gitee: {
      authorizeUrl: 'https://gitee.com/oauth/authorize',
      tokenUrl: 'https://gitee.com/oauth/token',
      userInfoUrl: 'https://gitee.com/api/v5/user',
      scopes: 'user'
    }
  };

  function getOAuthConfig(provider) {
    const cfg = OAUTH_CONFIG[provider];
    if (!cfg) throw fail('UNKNOWN_PROVIDER', '不支持的第三方平台: ' + provider);
    return cfg;
  }

  const stmtOAuthInsert = db.prepare(
    'INSERT INTO user_oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, linked_at) VALUES (?,?,?,?,?,?,?)'
  );
  const stmtOAuthFindByProviderUser = db.prepare(
    'SELECT * FROM user_oauth_accounts WHERE provider=? AND provider_user_id=?'
  );
  const stmtOAuthFindByUserProvider = db.prepare(
    'SELECT * FROM user_oauth_accounts WHERE user_id=? AND provider=?'
  );
  const stmtOAuthDelete = db.prepare(
    'DELETE FROM user_oauth_accounts WHERE user_id=? AND provider=?'
  );
  const stmtOAuthLinkUser = db.prepare(
    'UPDATE user_oauth_accounts SET user_id=? WHERE provider=? AND provider_user_id=?'
  );
  const stmtOAuthAllByUser = db.prepare(
    'SELECT provider, provider_user_id, access_token, refresh_token, token_expires_at, linked_at FROM user_oauth_accounts WHERE user_id=? ORDER BY linked_at'
  );

  function getAuthorizeUrl(provider, state) {
    const cfg = getOAuthConfig(provider);
    const clientId = (opts && opts.oauth && opts.oauth[provider] && opts.oauth[provider].clientId) || '';
    if (!clientId) throw fail('MISSING_CLIENT_ID', '未配置 ' + provider + ' 的 Client ID');
    const redirectUri = (opts && opts.oauthRedirectUri) || 'hexostudio://oauth/callback';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state || '',
      scope: cfg.scopes
    });
    return cfg.authorizeUrl + '?' + params.toString();
  }

  function linkAccount(input) {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    const i = input || {};
    const provider = String(i.provider || '').trim().toLowerCase();
    const accessToken = String(i.access_token || '');
    const refreshToken = String(i.refresh_token || '');
    const providerUserId = String(i.provider_user_id || '');
    const expiresIn = i.expires_in || null;
    if (!provider || !accessToken || !providerUserId) {
      throw fail('INVALID_INPUT', '缺少必要参数');
    }
    const cfg = getOAuthConfig(provider);
    const existing = stmtOAuthFindByProviderUser.get(provider, providerUserId);
    if (existing) {
      if (existing.user_id !== session.id) {
        throw fail('ACCOUNT_ALREADY_LINKED', '该第三方账号已绑定到其他用户');
      }
      return { ok: true, provider: provider, provider_user_id: providerUserId };
    }
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    stmtOAuthInsert.run(session.id, provider, providerUserId, accessToken, refreshToken, expiresAt, new Date().toISOString());
    return { ok: true, provider: provider, provider_user_id: providerUserId };
  }

  function unlinkAccount(provider) {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    const providerLower = String(provider || '').trim().toLowerCase();
    const result = stmtOAuthDelete.run(session.id, providerLower);
    if (result.changes === 0) throw fail('NOT_LINKED', '该第三方账号未绑定');
    return { ok: true, provider: providerLower };
  }

  function listLinkedAccounts() {
    if (!session) throw fail('NOT_LOGGED_IN', '尚未登录');
    return stmtOAuthAllByUser.all(session.id).map(row => ({
      provider: row.provider,
      provider_user_id: row.provider_user_id,
      linked_at: row.linked_at
    }));
  }

  function isLinked(provider) {
    if (!session) return false;
    const providerLower = String(provider || '').trim().toLowerCase();
    const row = stmtOAuthFindByUserProvider.get(session.id, providerLower);
    return !!row;
  }

  function findByProviderUser(provider, providerUserId) {
    const providerLower = String(provider || '').trim().toLowerCase();
    const row = stmtOAuthFindByProviderUser.get(providerLower, String(providerUserId || ''));
    if (!row) return null;
    return stmtById.get(row.user_id);
  }

  function logout() {
    const had = !!session;
    session = null;
    return had;
  }

  return { register, login, logout, currentUser, listUsers, count, getProfile, updateProfile, changePassword,
    getOAuthConfig, getAuthorizeUrl, linkAccount, unlinkAccount, listLinkedAccounts, isLinked,
    findByProviderUser, OAUTH_PROVIDERS, OAUTH_CONFIG, session: { get: () => session, set: (s) => { session = s; } }
  };
}

module.exports = { createAuthService };
