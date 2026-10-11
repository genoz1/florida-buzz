// Thin wrapper around Pinterest's v5 API for creating pins.
// While on Pinterest's "Trial" access tier, pin creation is blocked on the
// production API (returns a 403) — Pinterest requires using their Sandbox API
// instead until "Standard" access is approved. Set PINTEREST_USE_SANDBOX=true
// to test/demo against Sandbox; remove it (or set to false) once Standard
// access is granted to switch back to production automatically.
//
// Access tokens expire (~30 days). With PINTEREST_REFRESH_TOKEN + APP_ID +
// APP_SECRET set, this module refreshes automatically each process run.
// If posting fails with "Authentication failed", re-authorize via
// /admin/pinterest-auth and update DigitalOcean env vars (see formatAuthHint).
const { logPost } = require('./postLog');

function pinterestApiBase(env = process.env) {
  return env.PINTEREST_USE_SANDBOX === 'true'
    ? 'https://api-sandbox.pinterest.com'
    : 'https://api.pinterest.com';
}

// In-memory cache for the life of this process — each cron/script run gets a
// fresh process, so this mainly avoids refreshing twice within one run.
let cachedToken = null;
let cachedTokenExpiresAt = 0;
let lastRefreshError = null;

function hasRefreshCredentials(env = process.env) {
  return Boolean(env.PINTEREST_REFRESH_TOKEN && env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET);
}

function formatAuthHint(env = process.env, refreshError = lastRefreshError) {
  const siteUrl = (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
  const parts = [
    'Pinterest access token is invalid or expired.',
    `Re-authorize at ${siteUrl}/admin/pinterest-auth?key=ADMIN_PASSWORD`,
    'then set PINTEREST_ACCESS_TOKEN and PINTEREST_REFRESH_TOKEN in DigitalOcean and redeploy.',
  ];
  if (!hasRefreshCredentials(env)) {
    parts.push('PINTEREST_REFRESH_TOKEN / PINTEREST_APP_ID / PINTEREST_APP_SECRET are not all set, so auto-renew cannot run.');
  } else if (refreshError) {
    parts.push(`Token refresh also failed: ${refreshError}`);
  }
  if (env.PINTEREST_USE_SANDBOX === 'true') {
    parts.push('PINTEREST_USE_SANDBOX=true — production boards need this unset/false.');
  }
  return parts.join(' ');
}

function isPinterestAuthFailure(status, bodyText = '') {
  if (status === 401 || status === 403) return true;
  const text = String(bodyText || '');
  return /authentication failed/i.test(text)
    || /invalid.?access.?token/i.test(text)
    || /"code"\s*:\s*2\b/.test(text);
}

function formatPinFailureDetail({ status, bodyText, refreshError = lastRefreshError, env = process.env }) {
  const raw = String(bodyText || '').trim() || '(empty response body)';
  const prefix = status ? `HTTP ${status}` : 'HTTP ?';
  if (!isPinterestAuthFailure(status, raw)) {
    return `${prefix}: ${raw}`.slice(0, 500);
  }
  return `${prefix}: ${raw} | ${formatAuthHint(env, refreshError)}`.slice(0, 500);
}

function resetTokenCacheForTests() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
  lastRefreshError = null;
}

async function refreshAccessToken(env = process.env, fetchImpl = fetch) {
  if (!hasRefreshCredentials(env)) {
    return null; // no refresh credentials set up — caller falls back to the static env var
  }
  const basicAuth = Buffer.from(`${env.PINTEREST_APP_ID}:${env.PINTEREST_APP_SECRET}`).toString('base64');
  const res = await fetchImpl(`${pinterestApiBase(env)}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.PINTEREST_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    lastRefreshError = `HTTP ${res.status} ${errText}`.slice(0, 300);
    console.error(`  [pinterest] token refresh failed: ${lastRefreshError}`);
    return null;
  }
  const data = await res.json();
  if (!data.access_token) {
    lastRefreshError = 'refresh response missing access_token';
    console.error(`  [pinterest] token refresh failed: ${lastRefreshError}`);
    return null;
  }
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + ((data.expires_in || 3600) - 120) * 1000; // refresh 2 min early
  lastRefreshError = null;
  return cachedToken;
}

async function getAccessToken(env = process.env, fetchImpl = fetch) {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const refreshed = await refreshAccessToken(env, fetchImpl);
  if (refreshed) return refreshed;
  return env.PINTEREST_ACCESS_TOKEN || null; // fallback for before refresh is set up
}

async function createPin({ imageUrl, title, description, link }, { env = process.env, fetchImpl = fetch } = {}) {
  if (!imageUrl) {
    const detail = 'Pinterest pin skipped: imageUrl is required.';
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(detail);
  }
  if (!env.PINTEREST_BOARD_ID) {
    const detail = 'Pinterest pin skipped: PINTEREST_BOARD_ID is not set.';
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(detail);
  }

  const token = await getAccessToken(env, fetchImpl);
  if (!token) {
    const detail = formatPinFailureDetail({
      status: 401,
      bodyText: '{"code":2,"message":"Authentication failed.","status":"failure"}',
      env,
    });
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(`Pinterest API error 401: ${detail}`);
  }

  const res = await fetchImpl(`${pinterestApiBase(env)}/v5/pins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      link,
      title,
      description,
      board_id: env.PINTEREST_BOARD_ID,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const detail = formatPinFailureDetail({ status: res.status, bodyText: errText, env });
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(`Pinterest API error ${res.status}: ${detail}`);
  }

  await logPost({ platform: 'pinterest', status: 'success', detail: title ? title.slice(0, 100) : null });
  return res.json();
}

async function createVideoPin({ videoUrl, coverImageUrl, title, description, link }, { env = process.env, fetchImpl = fetch } = {}) {
  const token = await getAccessToken(env, fetchImpl);
  if (!token || !env.PINTEREST_BOARD_ID) {
    const detail = !token
      ? formatPinFailureDetail({
        status: 401,
        bodyText: '{"code":2,"message":"Authentication failed.","status":"failure"}',
        env,
      })
      : 'Pinterest video publishing is not configured (PINTEREST_BOARD_ID missing).';
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(token ? detail : `Pinterest API error 401: ${detail}`);
  }

  const apiBase = pinterestApiBase(env);

  const registered = await fetchImpl(`${apiBase}/v5/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ media_type: 'video' }),
  });
  const registration = await registered.json().catch(() => ({}));
  if (!registered.ok) {
    const errText = JSON.stringify(registration);
    const detail = formatPinFailureDetail({ status: registered.status, bodyText: errText, env });
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(`Pinterest video registration failed: ${detail}`);
  }

  const video = await fetchImpl(videoUrl);
  if (!video.ok) throw new Error(`Pinterest could not download Reel: ${video.status}`);
  const form = new FormData();
  for (const [key, value] of Object.entries(registration.upload_parameters || {})) form.append(key, value);
  form.append('file', await video.blob(), 'Florida-Buzz-Reel.mp4');
  const uploaded = await fetchImpl(registration.upload_url, { method: 'POST', body: form });
  if (!uploaded.ok) throw new Error(`Pinterest video upload failed: ${uploaded.status}`);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetchImpl(`${apiBase}/v5/media/${registration.media_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const state = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Pinterest video status failed: ${JSON.stringify(state)}`);
    if (state.status === 'succeeded') { ready = true; break; }
    if (state.status === 'failed') throw new Error(`Pinterest video processing failed: ${JSON.stringify(state)}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (!ready) throw new Error('Pinterest video processing did not finish in time.');

  const res = await fetchImpl(`${apiBase}/v5/pins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      link,
      title,
      description,
      board_id: env.PINTEREST_BOARD_ID,
      media_source: {
        source_type: 'video_id',
        cover_image_url: coverImageUrl,
        media_id: registration.media_id,
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    const detail = formatPinFailureDetail({ status: res.status, bodyText: errBody, env });
    await logPost({ platform: 'pinterest', status: 'failed', detail });
    throw new Error(`Pinterest API error ${res.status}: ${detail}`);
  }
  await logPost({ platform: 'pinterest', status: 'success', detail: title?.slice(0, 100) });
  return res.json();
}

module.exports = {
  createPin,
  createVideoPin,
  formatAuthHint,
  formatPinFailureDetail,
  isPinterestAuthFailure,
  hasRefreshCredentials,
  resetTokenCacheForTests,
  // Exported for focused tests / diagnostics only.
  getAccessToken,
  refreshAccessToken,
};
