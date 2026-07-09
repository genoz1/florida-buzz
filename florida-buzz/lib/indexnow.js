// Pings IndexNow (used by Bing and, by extension, Yahoo) the moment new
// content publishes, so it gets crawled same-day instead of waiting on the
// normal sitemap crawl cycle. Silently does nothing if INDEXNOW_KEY isn't set,
// so this is safe to call unconditionally from anywhere content gets saved.

async function notifyIndexNow(urls) {
  if (!process.env.INDEXNOW_KEY) return;

  const siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com';
  const host = new URL(siteUrl).hostname;
  const urlList = Array.isArray(urls) ? urls : [urls];

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key: process.env.INDEXNOW_KEY,
        keyLocation: `${siteUrl}/${process.env.INDEXNOW_KEY}.txt`,
        urlList,
      }),
    });
    if (!res.ok) {
      console.error(`  [error] IndexNow ping failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`  [error] IndexNow ping failed: ${err.message}`);
  }
}

module.exports = { notifyIndexNow };
