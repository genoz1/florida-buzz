'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authRemediationHint,
  getMetaAccessToken,
  isAuthFailureMessage,
  resetMetaTokenCacheForTests,
} = require('../lib/metaSocialTokens');

test('isAuthFailureMessage catches Meta OAuth / expired token errors', () => {
  assert.equal(isAuthFailureMessage('OAuthException: Error validating access token'), true);
  assert.equal(isAuthFailureMessage('Session has been invalidated'), true);
  assert.equal(isAuthFailureMessage('(#190) Access token has expired'), true);
  assert.equal(isAuthFailureMessage('container processing failed: timeout'), false);
});

test('authRemediationHint names the DigitalOcean env var', () => {
  assert.match(authRemediationHint('instagram'), /INSTAGRAM_ACCESS_TOKEN/);
  assert.match(authRemediationHint('threads'), /THREADS_ACCESS_TOKEN/);
  assert.match(authRemediationHint('instagram'), /DigitalOcean/);
});

test('getMetaAccessToken refreshes and persists a still-valid Instagram token', async () => {
  resetMetaTokenCacheForTests();
  const writes = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'social_platform_tokens');
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        async upsert(row) {
          writes.push(row);
          return { error: null };
        },
      };
    },
  };
  const fetchImpl = async (url) => {
    assert.match(String(url), /graph\.instagram\.com\/refresh_access_token/);
    assert.match(String(url), /grant_type=ig_refresh_token/);
    return {
      ok: true,
      async text() {
        return JSON.stringify({ access_token: 'ig-refreshed-token', expires_in: 5184000 });
      },
    };
  };

  const token = await getMetaAccessToken('instagram', {
    env: { INSTAGRAM_ACCESS_TOKEN: 'ig-seed-token' },
    supabase,
    fetchImpl,
  });
  assert.equal(token, 'ig-refreshed-token');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].platform, 'instagram');
  assert.equal(writes[0].access_token, 'ig-refreshed-token');
  assert.ok(writes[0].expires_at);

  // Second call should use memory cache (no extra refresh).
  let fetchCount = 0;
  const token2 = await getMetaAccessToken('instagram', {
    env: { INSTAGRAM_ACCESS_TOKEN: 'ig-seed-token' },
    supabase,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('should not refresh again');
    },
  });
  assert.equal(token2, 'ig-refreshed-token');
  assert.equal(fetchCount, 0);
});

test('getMetaAccessToken returns null when refresh fails with auth error and no fresh store', async () => {
  resetMetaTokenCacheForTests();
  const token = await getMetaAccessToken('threads', {
    env: { THREADS_ACCESS_TOKEN: 'dead-token' },
    supabase: null,
    fetchImpl: async () => ({
      ok: false,
      async text() {
        return JSON.stringify({ error: { message: 'Error validating access token', code: 190, type: 'OAuthException' } });
      },
    }),
  });
  assert.equal(token, null);
});
