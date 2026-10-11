const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPin,
  formatAuthHint,
  formatPinFailureDetail,
  isPinterestAuthFailure,
  hasRefreshCredentials,
  resetTokenCacheForTests,
} = require('../lib/pinterest');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

test('isPinterestAuthFailure detects Pinterest auth payloads and HTTP codes', () => {
  assert.equal(isPinterestAuthFailure(401, '{}'), true);
  assert.equal(isPinterestAuthFailure(403, '{}'), true);
  assert.equal(
    isPinterestAuthFailure(400, '{"code":2,"message":"Authentication failed.","status":"failure"}'),
    true
  );
  assert.equal(isPinterestAuthFailure(400, '{"message":"image too small"}'), false);
});

test('formatPinFailureDetail appends re-auth instructions for auth failures', () => {
  const detail = formatPinFailureDetail({
    status: 401,
    bodyText: '{"code":2,"message":"Authentication failed.","status":"failure"}',
    refreshError: null,
    env: {
      SITE_URL: 'https://thefloridabuzz.com',
    },
  });
  assert.match(detail, /HTTP 401/);
  assert.match(detail, /Authentication failed/);
  assert.match(detail, /admin\/pinterest-auth/);
  assert.match(detail, /PINTEREST_REFRESH_TOKEN/);
  assert.match(detail, /DigitalOcean/);
});

test('formatAuthHint warns when sandbox mode is enabled', () => {
  const hint = formatAuthHint({
    SITE_URL: 'https://thefloridabuzz.com',
    PINTEREST_USE_SANDBOX: 'true',
    PINTEREST_REFRESH_TOKEN: 'r',
    PINTEREST_APP_ID: 'id',
    PINTEREST_APP_SECRET: 'secret',
  }, 'HTTP 400 bad refresh');
  assert.match(hint, /PINTEREST_USE_SANDBOX=true/);
  assert.match(hint, /Token refresh also failed/);
});

test('hasRefreshCredentials requires all three refresh env vars', () => {
  assert.equal(hasRefreshCredentials({}), false);
  assert.equal(hasRefreshCredentials({
    PINTEREST_REFRESH_TOKEN: 'r',
    PINTEREST_APP_ID: 'id',
  }), false);
  assert.equal(hasRefreshCredentials({
    PINTEREST_REFRESH_TOKEN: 'r',
    PINTEREST_APP_ID: 'id',
    PINTEREST_APP_SECRET: 'secret',
  }), true);
});

test('createPin surfaces auth failure detail when the API rejects the token', async () => {
  resetTokenCacheForTests();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    assert.match(url, /\/v5\/pins$/);
    return jsonResponse(401, { code: 2, message: 'Authentication failed.', status: 'failure' });
  };

  await assert.rejects(
    () => createPin(
      {
        imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
        title: 'Test',
        description: 'Test pin',
        link: 'https://thefloridabuzz.com',
      },
      {
        env: {
          SITE_URL: 'https://thefloridabuzz.com',
          PINTEREST_ACCESS_TOKEN: 'expired-token',
          PINTEREST_BOARD_ID: 'board-1',
        },
        fetchImpl,
      }
    ),
    (err) => {
      assert.match(String(err.message), /Authentication failed/);
      assert.match(String(err.message), /admin\/pinterest-auth/);
      return true;
    }
  );
  assert.equal(calls.length, 1);
});

test('createPin refreshes an expired token before posting when refresh creds exist', async () => {
  resetTokenCacheForTests();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (String(url).includes('/oauth/token')) {
      return jsonResponse(200, { access_token: 'fresh-token', expires_in: 3600 });
    }
    if (String(url).includes('/v5/pins')) {
      assert.equal(options.headers.Authorization, 'Bearer fresh-token');
      return jsonResponse(201, { id: 'pin-1' });
    }
    throw new Error(`unexpected url ${url}`);
  };

  const result = await createPin(
    {
      imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
      title: 'Test',
      description: 'Test pin',
      link: 'https://thefloridabuzz.com',
    },
    {
      env: {
        SITE_URL: 'https://thefloridabuzz.com',
        PINTEREST_ACCESS_TOKEN: 'expired-token',
        PINTEREST_REFRESH_TOKEN: 'refresh',
        PINTEREST_APP_ID: 'app',
        PINTEREST_APP_SECRET: 'secret',
        PINTEREST_BOARD_ID: 'board-1',
      },
      fetchImpl,
    }
  );

  assert.equal(result.id, 'pin-1');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /oauth\/token/);
  assert.match(calls[1].url, /\/v5\/pins$/);
});

test('createPin fails clearly when refresh fails and no usable access token exists', async () => {
  resetTokenCacheForTests();
  const fetchImpl = async (url) => {
    if (String(url).includes('/oauth/token')) {
      return jsonResponse(400, { message: 'Invalid refresh token' });
    }
    throw new Error(`unexpected url ${url}`);
  };

  await assert.rejects(
    () => createPin(
      {
        imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
        title: 'Test',
        description: 'Test pin',
        link: 'https://thefloridabuzz.com',
      },
      {
        env: {
          SITE_URL: 'https://thefloridabuzz.com',
          PINTEREST_REFRESH_TOKEN: 'bad-refresh',
          PINTEREST_APP_ID: 'app',
          PINTEREST_APP_SECRET: 'secret',
          PINTEREST_BOARD_ID: 'board-1',
          // no PINTEREST_ACCESS_TOKEN fallback
        },
        fetchImpl,
      }
    ),
    (err) => {
      assert.match(String(err.message), /Authentication failed|invalid or expired/i);
      assert.match(String(err.message), /Token refresh also failed/);
      return true;
    }
  );
});
