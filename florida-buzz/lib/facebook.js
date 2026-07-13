// Shared Facebook Page posting helper, used by scripts/automate.js (article
// posts) and scripts/generate-guide.js (evergreen guide posts).
const { logPost } = require('./postLog');

async function postToFacebookPage({ message, link, imageUrl, dryRun = false }) {
  if (dryRun) {
    console.log(`  [dry-run] Would post to Facebook: "${message}"${link ? ` (link: ${link})` : ''}${imageUrl ? ` (image: ${imageUrl})` : ''}`);
    return true;
  }
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) {
    console.log('  [skip] FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set — skipping Facebook post.');
    return false;
  }

  // If we have an image, attach it directly via the /photos endpoint rather
  // than posting a bare link and relying on Facebook's own crawler to scrape
  // an og:image preview. That scrape-and-cache approach is timing-sensitive —
  // if Facebook's fetch of the image is slow (e.g. right after an image
  // finishes processing/uploading) it can silently fall back to a stale
  // cached image from an earlier, unrelated post on the same domain. Posting
  // the photo directly removes that failure mode entirely: the image shown
  // is always exactly the one we choose.
  if (imageUrl) {
    const caption = link ? `${message}\n\n${link}` : message;
    const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        caption,
        access_token: process.env.FB_PAGE_ACCESS_TOKEN,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`  [error] Facebook photo post failed: ${errText}`);
      await logPost({ platform: 'facebook', status: 'failed', detail: errText });
      return false;
    }

    await logPost({ platform: 'facebook', status: 'success', detail: message.slice(0, 100) });
    return true;
  }

  // No image available for this post (e.g. engagement posts, or a fallback
  // if image storage failed upstream) — fall back to the original link-only
  // post, same behavior as before.
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
