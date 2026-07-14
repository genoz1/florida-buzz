// Thin wrapper around Meta's "Instagram API with Instagram Login" for
// publishing a photo post. Unlike the classic Instagram Graph API (which
// requires a linked Facebook Page), this talks to graph.instagram.com
// directly using an Instagram-Login access token — no Page linking needed.
//
// Publishing is a two-step process: create a media "container" pointing at
// an image URL, then publish that container. Containers can take a few
// seconds to process, so we poll their status before publishing.
const { logPost } = require('./postLog');

const GRAPH_BASE = 'https://graph.instagram.com/v21.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainerReady(containerId, accessToken, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Instagram container status check failed: ${JSON.stringify(data)}`);
    }

    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR') {
      throw new Error(`Instagram container processing failed: ${JSON.stringify(data)}`);
    }
    // IN_PROGRESS — wait a couple seconds and check again.
    await sleep(2000);
  }
  throw new Error('Instagram container did not finish processing in time.');
}

// Under rate-limiting conditions, Meta's API has a known, documented quirk:
// the media_publish call can actually succeed in creating the post, but the
// confirmation response comes back as an error anyway (commonly "Application
// request limit reached", code 4 / subcode 2207051). Taking that error
// response at face value produces exactly the symptom we hit in practice:
// posts genuinely landing on Instagram while every attempt gets logged as a
// failure. Rather than trust a single unreliable response, double-check
// Instagram's own recent media list for a post matching what we just tried
// to publish before concluding it actually failed.
async function verifyRecentPublish(igUserId, accessToken, caption) {
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${igUserId}/media?fields=caption,timestamp&limit=5&access_token=${accessToken}`
    );
    if (!res.ok) return false;
    const data = await res.json();
    const recentCaptionStart = (caption || '').slice(0, 40);
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    return (data.data || []).some((item) => {
      const postedRecently = new Date(item.timestamp).getTime() >= fiveMinutesAgo;
      const captionMatches = recentCaptionStart && (item.caption || '').startsWith(recentCaptionStart);
      return postedRecently && captionMatches;
    });
  } catch {
    return false; // verification itself failing just means we fall back to trusting the original error
  }
}

async function createPost({ imageUrl, caption }) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_USER_ID;

  try {
    if (!accessToken || !igUserId) {
      throw new Error('INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID not set.');
    }

    // Step 1: create the media container.
    const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(`Instagram container creation failed: ${JSON.stringify(createData)}`);
    }

    const containerId = createData.id;

    // Step 2: wait for Instagram to finish processing the image.
    await waitForContainerReady(containerId, accessToken);

    // Step 3: publish the container.
    const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });
    const publishData = await publishRes.json();

    if (!publishRes.ok) {
      // Meta said this failed — but under rate limiting, that response can be
      // wrong. Check Instagram's actual recent posts before believing it.
      console.log('  Instagram reported an error on publish — double-checking whether it actually posted anyway...');
      const actuallyPosted = await verifyRecentPublish(igUserId, accessToken, caption);
      if (actuallyPosted) {
        console.log('  Confirmed: it posted successfully despite the error response. Logging as success.');
        await logPost({ platform: 'instagram', status: 'success', detail: `${(caption || '').slice(0, 100)} (recovered after false-error response)` });
        return { recovered: true };
      }
      throw new Error(`Instagram publish failed: ${JSON.stringify(publishData)}`);
    }

    await logPost({ platform: 'instagram', status: 'success', detail: caption ? caption.slice(0, 100) : null });
    return publishData;
  } catch (err) {
    await logPost({ platform: 'instagram', status: 'failed', detail: err.message });
    throw err;
  }
}

module.exports = { createPost };
