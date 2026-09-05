const { createAuthService } = require('../src/core/auth');
const { openDatabase } = require('../src/core/db');
const { tmpDbPath } = require('./helpers');

function fakeBcrypt() {
  return {
    hashSync: (pw) => 'H$' + pw,
    compareSync: (pw, hash) => hash === 'H$' + pw
  };
}

describe('auth OAuth methods', () => {
  let db, auth;

  beforeEach(() => {
    db = openDatabase(tmpDbPath('auth-oauth'));
    auth = createAuthService(db, {
      bcrypt: fakeBcrypt(),
      rounds: 4,
      oauth: {
        github: { clientId: 'gh-client-id', clientSecret: 'gh-secret' },
        gitee: { clientId: 'ge-client-id', clientSecret: 'ge-secret' }
      },
      oauthRedirectUri: 'hexostudio://oauth/callback'
    });
  });
  afterEach(() => { try { db.close(); } catch (_) {} db = null; auth = null; });

  describe('getAuthorizeUrl', () => {
    test('returns a valid GitHub authorize URL', () => {
      const url = auth.getAuthorizeUrl('github', 'state123');
      expect(url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe('gh-client-id');
      expect(parsed.searchParams.get('redirect_uri')).toBe('hexostudio://oauth/callback');
      expect(parsed.searchParams.get('state')).toBe('state123');
      expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
    });

    test('returns a valid Gitee authorize URL', () => {
      const url = auth.getAuthorizeUrl('gitee', '');
      expect(url).toMatch(/^https:\/\/gitee\.com\/oauth\/authorize\?/);
      const parsed = new URL(url);
      expect(parsed.searchParams.get('scope')).toBe('user');
    });

    test('throws for unknown provider', () => {
      expect(() => auth.getAuthorizeUrl('twitter', '')).toThrow(/不支持的第三方平台/);
    });

    test('throws when client_id is missing', () => {
      const authNoConfig = createAuthService(db, { bcrypt: fakeBcrypt(), rounds: 4 });
      expect(() => authNoConfig.getAuthorizeUrl('github', '')).toThrow(/未配置.*Client ID/);
    });
  });

  describe('linkAccount / isLinked / listLinkedAccounts', () => {
    let userId;
    beforeEach(() => {
      const u = auth.register({ username: 'alice', password: 'secret1234' });
      userId = u.id;
    });

    test('links a GitHub account', () => {
      const r = auth.linkAccount({
        provider: 'github',
        access_token: 'gh-token-abc',
        provider_user_id: 'gh-user-123',
        expires_in: 7200
      });
      expect(r.ok).toBe(true);
      expect(r.provider).toBe('github');
      expect(auth.isLinked('github')).toBe(true);
      expect(auth.isLinked('gitee')).toBe(false);
    });

    test('lists linked accounts', () => {
      auth.linkAccount({ provider: 'github', access_token: 't1', provider_user_id: 'u1' });
      auth.linkAccount({ provider: 'gitee', access_token: 't2', provider_user_id: 'u2' });
      const accounts = auth.listLinkedAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts.map(a => a.provider)).toContain('github');
      expect(accounts.map(a => a.provider)).toContain('gitee');
    });

    test('rejects linking same provider twice to same user (idempotent)', () => {
      auth.linkAccount({ provider: 'github', access_token: 't1', provider_user_id: 'u1' });
      // Second link with same provider_user_id should succeed (no error)
      const r2 = auth.linkAccount({ provider: 'github', access_token: 't1-updated', provider_user_id: 'u1' });
      expect(r2.ok).toBe(true);
    });

    test('rejects linking a provider_user_id already owned by another user', () => {
      auth.linkAccount({ provider: 'github', access_token: 't1', provider_user_id: 'shared-user' });
      // Register bob — this overwrites the session to bob
      const u2 = auth.register({ username: 'bob', password: 'secret1234' });
      // Switch session to bob
      auth.session.set({ id: u2.id, username: 'bob' });
      expect(() => auth.linkAccount({ provider: 'github', access_token: 't2', provider_user_id: 'shared-user' }))
        .toThrow(/已绑定到其他用户/);
    });

    test('requires login to link', () => {
      auth.logout();
      expect(() => auth.linkAccount({ provider: 'github', access_token: 't', provider_user_id: 'u' }))
        .toThrow(/尚未登录/);
    });

    test('requires valid input', () => {
      expect(() => auth.linkAccount({ provider: '', access_token: 't', provider_user_id: 'u' }))
        .toThrow(/缺少必要参数/);
      expect(() => auth.linkAccount({ provider: 'github', access_token: '', provider_user_id: 'u' }))
        .toThrow(/缺少必要参数/);
    });
  });

  describe('unlinkAccount', () => {
    let userId;
    beforeEach(() => {
      const u = auth.register({ username: 'alice', password: 'secret1234' });
      userId = u.id;
      auth.linkAccount({ provider: 'github', access_token: 't', provider_user_id: 'u1' });
    });

    test('unlinks an account', () => {
      const r = auth.unlinkAccount('github');
      expect(r.ok).toBe(true);
      expect(auth.isLinked('github')).toBe(false);
      expect(auth.listLinkedAccounts()).toHaveLength(0);
    });

    test('throws when not linked', () => {
      auth.unlinkAccount('github');
      expect(() => auth.unlinkAccount('github')).toThrow(/未绑定/);
    });

    test('is case-insensitive', () => {
      auth.unlinkAccount('GITHUB');
      expect(auth.isLinked('github')).toBe(false);
    });
  });

  describe('findByProviderUser', () => {
    let aliceId;
    beforeEach(() => {
      const u = auth.register({ username: 'alice', password: 'secret1234' });
      aliceId = u.id;
      auth.linkAccount({ provider: 'github', access_token: 't', provider_user_id: 'gh-100' });
    });

    test('finds user by provider and provider_user_id', () => {
      const row = auth.findByProviderUser('github', 'gh-100');
      expect(row).toBeTruthy();
      expect(row.username).toBe('alice');
    });

    test('returns null for non-existent binding', () => {
      expect(auth.findByProviderUser('github', 'nonexistent')).toBeNull();
    });
  });
});
