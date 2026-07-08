// Thin wrapper around Pinterest's v5 API for creating pins.
// While on Pinterest's "Trial" access tier, pin creation is blocked on the
// production API (returns a 403) — Pinterest requires using their Sandbox API
// instead until "Standard" access is approved. Set PINTEREST_USE_SANDBOX=true
// to test/demo against Sandbox; remove it (or set to false) once Standard
// access is granted to switch back to production automatically.
const PINTEREST_API_BASE = process.env.PINTEREST_USE_SANDBOX === 'true'
  ? 'https://api-sandbox.pinterest.com'
  : 'https://api.pinterest.com';

async function createPin({ imageUrl, title, description, link }) {
  const res = await fetch(`${PINTEREST_API_BASE}/v5/pins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
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
    throw new Error(`Pinterest API error ${res.status}: ${errText}`);
  }

  return res.json();
}

module.exports = { createPin };
