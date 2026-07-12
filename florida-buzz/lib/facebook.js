// Shared Facebook Page posting helper, used by scripts/automate.js (article posts)
// and scripts/promo-post.js (brand/newsletter/guide promo posts).
const { logPost } = require('./postLog');

async function postToFacebookPage({ message, link, dryRun = false }) {
  if (dryRun) {
    console.log(`  [dry-run] Would post to Facebook: "${message}"${link ? ` (link: ${link})` : ''}`);
    return true;
  }
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) {
    console.log('  [skip] FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set — skipping Facebook post.');
    return false;
  }

  const body = {
    message,
    access_token: process.env.FB_PAGE_ACCESS_TOKEN,
  };
  if (link) body.link = link;

  const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  [error] Facebook post failed: ${errText}`);
    await logPost({ platform: 'facebook', status: 'failed', detail: errText });
    return false;
  }

  await logPost({ platform: 'facebook', status: 'success', detail: message.slice(0, 100) });
  return true;
}

module.exports = { postToFacebookPage };
