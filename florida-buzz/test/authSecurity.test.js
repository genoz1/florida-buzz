const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getAuthConfig, validateAuthConfig } = require('../lib/auth/config');
const { createCsrfProtection } = require('../lib/auth/csrf');
const { decryptJson, encryptJson } = require('../lib/auth/crypto');
const { createAuthMiddleware } = require('../lib/auth/middleware');
const { startAuthCleanup } = require('../lib/auth');
const { createSupabaseRateLimiter } = require('../lib/auth/rateLimit');
const { AuthError, createAuthService } = require('../lib/auth/service');
const { createTurnstileVerifier } = require('../lib/auth/turnstile');

function createMemoryFoundation(now) {
  const state = {
    challenges: new Map(),
    profiles: new Map(),
    sessions: new Map(),
    subscribers: [],
    requestedEmails: [],
    refreshed: 0,
    rateLimits: [],
    turnstileTokens: [],
  };
  let nextChallenge = 0;
  let nextSession = 0;
  let verified = null;

  const store = {
    async createChallenge(value) {
      const challengeId = `challenge-${++nextChallenge}`;
      state.challenges.set(challengeId, {
        ...value,
        otpAttempts: 0,
        expiresAt: new Date(now().getTime() + value.ttlSeconds * 1000).toISOString(),
        consumedAt: null,
      });
      return { challengeId };
    },
    async getChallenge(id) { return state.challenges.get(id) || null; },
    async incrementChallengeAttempts(id, attempts) { state.challenges.get(id).otpAttempts = attempts; },
    async consumeChallenge(id) {
      const challenge = state.challenges.get(id);
      if (challenge) challenge.consumedAt = now().toISOString();
    },
    async upsertProfile(userId, displayName) {
      const existing = state.profiles.get(userId);
      const profile = existing || { user_id: userId, role: 'member', status: 'active' };
      profile.display_name = displayName;
      state.profiles.set(userId, profile);
      return profile;
    },
    async getProfile(userId) { return state.profiles.get(userId) || null; },
    async subscribeWithConsent(email) { state.subscribers.push(email); },
    async createSession(value) {
      const sessionId = `session-${++nextSession}`;
      state.sessions.set(sessionId, {
        userId: value.userId,
        tokens: { accessToken: value.accessToken, refreshToken: value.refreshToken },
        accessTokenExpiresAt: value.accessTokenExpiresAt.toISOString(),
        idleExpiresAt: new Date(now().getTime() + value.idleSeconds * 1000).toISOString(),
        absoluteExpiresAt: new Date(now().getTime() + value.absoluteSeconds * 1000).toISOString(),
        revokedAt: null,
      });
      return { sessionId };
    },
    async getSession(id) { return state.sessions.get(id) || null; },
    async updateSession(id, update) {
      const session = state.sessions.get(id);
      session.idleExpiresAt = update.idleExpiresAt.toISOString();
      if (update.accessToken) {
        session.tokens = { accessToken: update.accessToken, refreshToken: update.refreshToken };
        session.accessTokenExpiresAt = update.accessTokenExpiresAt.toISOString();
      }
    },
    async revokeSession(id) {
      state.sessions.delete(id);
    },
  };

  const provider = {
    async requestOtp(email) { state.requestedEmails.push(email); },
    async verifyOtp() { return verified; },
    async refreshSession() {
      state.refreshed += 1;
      return {
        user: { id: 'user-1', email: 'reader@example.com' },
        session: { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expires_at: Math.floor(now().getTime() / 1000) + 3600 },
      };
    },
  };
  const limiter = {
    async consume(namespace, identifier) {
      state.rateLimits.push({ namespace, identifier });
      return { allowed: true, remaining: 2, retryAfterSeconds: 0 };
    },
  };
  const verifyTurnstile = async (token) => {
    state.turnstileTokens.push(token);
    return { ok: token === 'turnstile-ok' };
  };
  const config = {
    challengeTtlSeconds: 600,
    sessionIdleSeconds: 86400,
    sessionAbsoluteSeconds: 604800,
    sessionCookieName: 'fb_session',
    secureCookies: false,
  };
  const service = createAuthService({ store, provider, limiter, verifyTurnstile, config, now: () => now() });
  return {
    config,
    limiter,
    provider,
    service,
    state,
    store,
    setVerified(value) { verified = value; },
  };
}

function createFakeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookies: {},
    cleared: [],
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
    clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('OTP request validates input, Turnstile, and an unchecked newsletter choice', async () => {
  const now = () => new Date('2026-10-03T16:00:00Z');
  const foundation = createMemoryFoundation(now);
  await assert.rejects(
    foundation.service.requestOtp({ email: 'bad', displayName: 'A', turnstileToken: 'turnstile-ok' }),
    (error) => error instanceof AuthError && error.code === 'invalid_auth_input'
  );

  const result = await foundation.service.requestOtp({
    email: ' Reader@Example.com ',
    displayName: '  Florida   Reader ',
    newsletterOptIn: 'true',
    turnstileToken: 'turnstile-ok',
  }, { ip: '192.0.2.1' });

  assert.equal(result.challengeId, 'challenge-1');
  assert.deepEqual(foundation.state.requestedEmails, ['reader@example.com']);
  const stored = foundation.state.challenges.get('challenge-1');
  assert.equal(stored.displayName, 'Florida Reader');
  assert.equal(stored.newsletterOptIn, false);
  assert.equal(foundation.state.subscribers.length, 0);
  assert.deepEqual(foundation.state.turnstileTokens, ['turnstile-ok']);
});

test('retention cleanup is scheduled once, bounded, non-overlapping, and stoppable', async () => {
  let queued;
  let intervalCallback;
  let cleared = false;
  let unreferenced = false;
  let release;
  const calls = [];
  const store = {
    async cleanupExpired(batchSize) {
      calls.push(batchSize);
      await new Promise((resolve) => { release = resolve; });
    },
  };
  const schedule = startAuthCleanup(store, {
    batchSize: 250,
    logger: { warn() { assert.fail('cleanup should not fail'); } },
    queueMicrotaskFn(callback) { queued = callback; },
    setIntervalFn(callback, intervalMs) {
      intervalCallback = callback;
      assert.equal(intervalMs, 6 * 60 * 60 * 1000);
      return { unref() { unreferenced = true; } };
    },
    clearIntervalFn() { cleared = true; },
  });

  const first = queued();
  await Promise.resolve();
  await intervalCallback();
  assert.deepEqual(calls, [250]);
  release();
  await first;
  schedule.stop();
  assert.equal(unreferenced, true);
  assert.equal(cleared, true);
});

test('auth migration avoids reserved time identifiers and defines bounded cleanup', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261003170000_private_auth_security_foundation.sql'),
    'utf8'
  );
  assert.match(migration, /v_now timestamptz := clock_timestamp\(\)/);
  assert.doesNotMatch(migration, /current_time timestamptz := clock_timestamp\(\)/);
  assert.match(migration, /cleanup_expired_auth_security/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /limit p_batch_size/g);
});

test('OTP request fails closed when Turnstile rejects', async () => {
  const foundation = createMemoryFoundation(() => new Date('2026-10-03T16:00:00Z'));
  await assert.rejects(
    foundation.service.requestOtp({ email: 'reader@example.com', displayName: 'Reader', turnstileToken: 'bad' }),
    (error) => error.code === 'turnstile_rejected'
  );
  assert.equal(foundation.state.requestedEmails.length, 0);
});

test('OTP request stops at the shared rate limit and reports retry timing', async () => {
  const foundation = createMemoryFoundation(() => new Date('2026-10-03T16:00:00Z'));
  foundation.limiter.consume = async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 90 });
  await assert.rejects(
    foundation.service.requestOtp({ email: 'reader@example.com', displayName: 'Reader', turnstileToken: 'turnstile-ok' }),
    (error) => error.code === 'rate_limited' && error.status === 429 && error.retryAfterSeconds === 90
  );
  assert.equal(foundation.state.requestedEmails.length, 0);
});

test('invalid OTP increments attempts and creates no profile or session', async () => {
  const foundation = createMemoryFoundation(() => new Date('2026-10-03T16:00:00Z'));
  const request = await foundation.service.requestOtp({
    email: 'reader@example.com', displayName: 'Reader', turnstileToken: 'turnstile-ok',
  });
  foundation.setVerified(null);
  await assert.rejects(
    foundation.service.verifyOtp({ challengeId: request.challengeId, otp: '123456' }),
    (error) => error.code === 'invalid_otp'
  );
  assert.equal(foundation.state.challenges.get(request.challengeId).otpAttempts, 1);
  assert.equal(foundation.state.profiles.size, 0);
  assert.equal(foundation.state.sessions.size, 0);
});

test('verified OTP creates a private member profile and server-side session without exposing email or tokens', async () => {
  const now = () => new Date('2026-10-03T16:00:00Z');
  const foundation = createMemoryFoundation(now);
  const request = await foundation.service.requestOtp({
    email: 'reader@example.com', displayName: 'Reader', newsletterOptIn: false, turnstileToken: 'turnstile-ok',
  });
  foundation.setVerified({
    user: { id: 'user-1', email: 'reader@example.com' },
    session: { access_token: 'provider-access', refresh_token: 'provider-refresh', expires_at: 1791046800 },
  });
  const result = await foundation.service.verifyOtp({ challengeId: request.challengeId, otp: '123456' });

  assert.deepEqual(result.user, { id: 'user-1', displayName: 'Reader', role: 'member', status: 'active' });
  assert.equal(JSON.stringify(result).includes('reader@example.com'), false);
  assert.equal(JSON.stringify(result).includes('provider-access'), false);
  assert.equal(foundation.state.subscribers.length, 0);
  assert.equal(foundation.state.sessions.size, 1);
  assert.ok(foundation.state.challenges.get(request.challengeId).consumedAt);
});

test('newsletter record is written only after explicit boolean consent and successful verification', async () => {
  const foundation = createMemoryFoundation(() => new Date('2026-10-03T16:00:00Z'));
  const request = await foundation.service.requestOtp({
    email: 'optin@example.com', displayName: 'Opt In', newsletterOptIn: true, turnstileToken: 'turnstile-ok',
  });
  foundation.setVerified({
    user: { id: 'user-2', email: 'optin@example.com' },
    session: { access_token: 'a', refresh_token: 'r', expires_at: 1791046800 },
  });
  await foundation.service.verifyOtp({ challengeId: request.challengeId, otp: '654321' });
  assert.deepEqual(foundation.state.subscribers, ['optin@example.com']);
});

test('sessions refresh server-side, expire, and revoke on logout', async () => {
  let current = new Date('2026-10-03T16:00:00Z');
  const foundation = createMemoryFoundation(() => current);
  foundation.state.profiles.set('user-1', { user_id: 'user-1', display_name: 'Reader', role: 'member', status: 'active' });
  foundation.state.sessions.set('refresh-me', {
    userId: 'user-1', tokens: { accessToken: 'old', refreshToken: 'refresh' },
    accessTokenExpiresAt: new Date(current.getTime() + 30_000).toISOString(),
    idleExpiresAt: new Date(current.getTime() + 60_000).toISOString(),
    absoluteExpiresAt: new Date(current.getTime() + 120_000).toISOString(), revokedAt: null,
  });
  const authenticated = await foundation.service.authenticate('refresh-me');
  assert.equal(authenticated.user.displayName, 'Reader');
  assert.equal(foundation.state.refreshed, 1);
  assert.equal(foundation.state.sessions.get('refresh-me').tokens.accessToken, 'refreshed-access');

  await foundation.service.logout('refresh-me');
  assert.equal(foundation.state.sessions.has('refresh-me'), false);
  await assert.rejects(foundation.service.authenticate('refresh-me'), (error) => error.code === 'authentication_required');

  foundation.state.sessions.set('expired', {
    userId: 'user-1', tokens: { accessToken: 'old', refreshToken: 'refresh' },
    accessTokenExpiresAt: current.toISOString(), idleExpiresAt: new Date(current.getTime() - 1).toISOString(),
    absoluteExpiresAt: new Date(current.getTime() + 1000).toISOString(), revokedAt: null,
  });
  await assert.rejects(foundation.service.authenticate('expired'), (error) => error.code === 'session_expired');
  assert.equal(foundation.state.sessions.has('expired'), false);
});

test('authentication and role middleware reject missing sessions and unauthorized members', async () => {
  const foundation = createMemoryFoundation(() => new Date('2026-10-03T16:00:00Z'));
  const middleware = createAuthMiddleware({ service: foundation.service, config: foundation.config });
  const missingResponse = createFakeResponse();
  await middleware.requireAuth({ headers: {} }, missingResponse, () => assert.fail('must not authenticate'));
  assert.equal(missingResponse.statusCode, 401);

  const memberResponse = createFakeResponse();
  middleware.requireRole('moderator', 'admin')(
    { auth: { user: { role: 'member' } } }, memberResponse, () => assert.fail('member must be denied')
  );
  assert.equal(memberResponse.statusCode, 403);

  let allowed = false;
  middleware.requireRole('moderator', 'admin')(
    { auth: { user: { role: 'moderator' } } }, createFakeResponse(), () => { allowed = true; }
  );
  assert.equal(allowed, true);
});

test('session cookies are HTTP-only, SameSite protected, Secure in production, and bounded', () => {
  const service = { authenticate: async () => null };
  const config = { sessionCookieName: '__Host-fb_session', secureCookies: true, sessionAbsoluteSeconds: 604800 };
  const middleware = createAuthMiddleware({ service, config });
  const response = createFakeResponse();
  middleware.setSessionCookie(response, 'opaque-session');
  assert.equal(response.cookies['__Host-fb_session'].value, 'opaque-session');
  assert.deepEqual(response.cookies['__Host-fb_session'].options, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 604800000,
  });
});

test('CSRF protection accepts the issued token and rejects missing or mismatched tokens', () => {
  const csrf = createCsrfProtection({ key: Buffer.alloc(32, 7), cookieName: 'fb_csrf', secure: false, ttlSeconds: 60 });
  const issueResponse = createFakeResponse();
  const token = csrf.issue(issueResponse);
  const cookie = issueResponse.cookies.fb_csrf.value;

  let accepted = false;
  csrf.requireToken({ headers: { cookie: `fb_csrf=${encodeURIComponent(cookie)}` }, get: () => token }, createFakeResponse(), () => { accepted = true; });
  assert.equal(accepted, true);

  const rejected = createFakeResponse();
  csrf.requireToken({ headers: { cookie: `fb_csrf=${encodeURIComponent(cookie)}` }, get: () => 'wrong' }, rejected, () => assert.fail('must reject'));
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.body, { error: 'csrf_rejected' });
});

test('Turnstile local mode is explicit and production fails closed on missing/rejected verification', async () => {
  const local = createTurnstileVerifier({ mode: 'disabled', secret: '', production: false });
  assert.deepEqual(await local('', ''), { ok: true, mode: 'disabled-local-test' });

  const productionDisabled = createTurnstileVerifier({ mode: 'disabled', secret: '', production: true });
  assert.equal((await productionDisabled('', '')).ok, false);

  const rejected = createTurnstileVerifier({
    mode: 'verify', secret: 'private', production: true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) }),
  });
  assert.equal((await rejected('bad-token', '192.0.2.1')).ok, false);

  const unavailable = createTurnstileVerifier({
    mode: 'verify', secret: 'private', production: true,
    fetchImpl: async () => { throw new Error('network unavailable'); },
  });
  assert.deepEqual(await unavailable('token', '192.0.2.1'), { ok: false, reason: 'turnstile_unavailable' });
});

test('shared rate limiting hashes identifiers before database storage', async () => {
  let params;
  const limiter = createSupabaseRateLimiter({
    key: Buffer.alloc(32, 9),
    client: { rpc: async (_name, value) => { params = value; return { data: [{ allowed: false, remaining: 0, retry_after_seconds: 42 }], error: null }; } },
  });
  const result = await limiter.consume('otp-email', 'reader@example.com', 3, 900);
  assert.equal(result.allowed, false);
  assert.equal(result.retryAfterSeconds, 42);
  assert.equal(params.p_bucket_key.length, 64);
  assert.equal(JSON.stringify(params).includes('reader@example.com'), false);
});

test('auth encryption is authenticated and does not retain plaintext', () => {
  const key = Buffer.alloc(32, 11);
  const encrypted = encryptJson(key, { email: 'private@example.com', refreshToken: 'private-token' });
  assert.equal(encrypted.includes('private@example.com'), false);
  assert.deepEqual(decryptJson(key, encrypted), { email: 'private@example.com', refreshToken: 'private-token' });
  assert.throws(() => decryptJson(Buffer.alloc(32, 12), encrypted));
});

test('production configuration requires private security and Turnstile settings only when auth is enabled', () => {
  assert.doesNotThrow(() => validateAuthConfig(getAuthConfig({ NODE_ENV: 'production' }), {}));
  assert.throws(() => validateAuthConfig(getAuthConfig({
    NODE_ENV: 'production', READER_AUTH_ENABLED: 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon',
  }), { serviceClient: {} }), /AUTH_SECURITY_KEY/);

  const configured = getAuthConfig({
    NODE_ENV: 'production', READER_AUTH_ENABLED: 'true', SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon', AUTH_SECURITY_KEY: Buffer.alloc(32, 1).toString('base64'),
    TURNSTILE_MODE: 'verify', TURNSTILE_SECRET_KEY: 'private',
  });
  assert.doesNotThrow(() => validateAuthConfig(configured, { serviceClient: {} }));
});

test('Phase 2 migration enforces profile privacy, role controls, and service-only auth storage', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20261003170000_private_auth_security_foundation.sql'),
    'utf8'
  );
  for (const table of ['profiles', 'auth_challenges', 'auth_sessions', 'auth_rate_limits']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /create policy profiles_select_own[\s\S]*auth\.uid\(\)[\s\S]*user_id/i);
  assert.doesNotMatch(migration, /grant\s+(?:all|select)[\s\S]*profiles\s+to\s+anon/i);
  assert.deepEqual([...migration.matchAll(/create policy\s+([a-z_][a-z0-9_]*)/gi)].map((match) => match[1]), ['profiles_select_own']);
  assert.match(migration, /revoke all on public\.auth_sessions from public, anon, authenticated/i);
  assert.match(migration, /role in \('member', 'moderator', 'admin'\)/i);
  assert.match(migration, /status in \('active', 'suspended', 'blocked'\)/i);
  const profileDefinition = migration.match(/create table public\.profiles \(([\s\S]*?)\n\);/i)[1];
  assert.doesNotMatch(profileDefinition, /\bemail\b/i);
  for (const operationalTable of ['articles', 'subscribers', 'seen_feed_items', 'article_generation_queue', 'post_log', 'not_found_log', 'restaurants', 'engagement_posts', 'feature_promo_images', 'feature_promo_posts']) {
    assert.doesNotMatch(migration, new RegExp(`alter table public\\.${operationalTable}\\b`, 'i'));
  }
});
