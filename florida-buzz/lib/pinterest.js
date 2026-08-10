// Thin wrapper around Pinterest's v5 API for creating pins.
// While on Pinterest's "Trial" access tier, pin creation is blocked on the
// production API (returns a 403) — Pinterest requires using their Sandbox API
// instead until "Standard" access is approved. Set PINTEREST_USE_SANDBOX=true
// to test/demo against Sandbox; remove it (or set to false) once Standard
// access is granted to switch back to production automatically.
const { logPost } = require('./postLog');

const PINTEREST_API_BASE = process.env.PINTEREST_USE_SANDBOX === 'true'
  ? 'https://api-sandbox.pinterest.com'
  : 'https://api.pinterest.com';

// In-memory cache for the life of this process — each cron/script run gets a
// fresh process, so this mainly avoids refreshing twice within one run.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function refreshAccessToken() {
  if (!process.env.PINTEREST_REFRESH_TOKEN || !process.env.PINTEREST_APP_ID || !process.env.PINTEREST_APP_SECRET) {
    return null; // no refresh credentials set up — caller falls back to the static env var
  }
  const basicAuth = Buffer.from(`${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`).toString('base64');
  const res = await fetch(`${PINTEREST_API_BASE}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.PINTEREST_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) {
    console.error(`  [pinterest] token refresh failed: ${res.status} ${await res.text()}`);
    return null;
  }
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.now() + ((data.expires_in || 3600) - 120) * 1000; // refresh 2 min early
  return cachedToken;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;
  return process.env.PINTEREST_ACCESS_TOKEN || null; // fallback for before refresh is set up
}

async function createPin({ imageUrl, title, description, link }) {
  const token = await getAccessToken();
  const res = await fetch(`${PINTEREST_API_BASE}/v5/pins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      link,
      title,
      description,
      board_id: process.env.PINTEREST_BOARD_ID,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    await logPost({ platform: 'pinterest', status: 'failed', detail: errText });
    throw new Error(`Pinterest API error ${res.status}: ${errText}`);
  }

  await logPost({ platform: 'pinterest', status: 'success', detail: title ? title.slice(0, 100) : null });
  return res.json();
}

module.exports = { createPin };
