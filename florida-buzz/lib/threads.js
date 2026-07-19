// Thin wrapper around Meta's Threads API for publishing a text+image post.
// Built on the same underlying Graph API infrastructure as Instagram, so it
// uses the same two-step pattern: create a media container, then publish it.
const { logPost } = require('./postLog');

const GRAPH_BASE = 'https://graph.threads.net/v1.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForContainerReady(containerId, accessToken, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${GRAPH_BASE}/${containerId}?fields=status&access_token=${accessToken}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Threads container status check failed: ${JSON.stringify(data)}`);
    }

    if (data.status === 'FINISHED') return true;
    if (data.status === 'ERROR') {
      throw new Error(`Threads container processing failed: ${JSON.stringify(data)}`);
    }
    // IN_PROGRESS — wait a couple seconds and check again.
    await sleep(2000);
  }
  throw new Error('Threads container did not finish processing in time.');
}

// Under rate-limiting or transient conditions, Meta's API has the same
// documented quirk on Threads that we found and fixed on Instagram: the
// publish call can actually succeed in creating the post, but the
// confirmation response comes back as an error anyway (e.g. "Media Not
// Found" right after a real publish). Rather than trust a single unreliable
// response, double-check the account's own recent posts for a match before
// concluding it actually failed.
async function verifyRecentPublish(userId, accessToken, text) {
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${userId}/threads?fields=text,timestamp&limit=5&access_token=${accessToken}`
    );
    if (!res.ok) return false;
    const data = await res.json();
    const recentTextStart = (text || '').slice(0, 40);
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    return (data.data || []).some((item) => {
      const postedRecently = new Date(item.timestamp).getTime() >= fiveMinutesAgo;
      const textMatches = recentTextStart && (item.text || '').startsWith(recentTextStart);
      return postedRecently && textMatches;
    });
  } catch {
    return false; // verification itself failing just means we fall back to trusting the original error
  }
}

async function createPost({ text, imageUrl }) {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;

  try {
    if (!accessToken || !userId) {
      throw new Error('THREADS_ACCESS_TOKEN / THREADS_USER_ID not set.');
    }

    // Step 1: create the media container. IMAGE type if we have a photo,
    // otherwise TEXT-only — Threads supports both, unlike Instagram which
    // requires an image.
    const createRes = await fetch(`${GRAPH_BASE}/${userId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: imageUrl ? 'IMAGE' : 'TEXT',
        text,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        access_token: accessToken,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(`Threads container creation failed: ${JSON.stringify(createData)}`);
    }

    const containerId = createData.id;

    // Step 2: wait for Threads to finish processing (only really matters for images).
    if (imageUrl) {
      await waitForContainerReady(containerId, accessToken);
    }

    // Step 3: publish the container.
    const publishRes = await fetch(`${GRAPH_BASE}/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    });
    const publishData = await publishRes.json();

    if (!publishRes.ok) {
      // Meta said this failed — but that response can be wrong under
      // rate-limiting/transient conditions. Check Threads' actual recent
      // posts before believing it.
      console.log('  Threads reported an error on publish — double-checking whether it actually posted anyway...');
      const actuallyPosted = await verifyRecentPublish(userId, accessToken, text);
      if (actuallyPosted) {
        console.log('  Confirmed: it posted successfully despite the error response. Logging as success.');
        await logPost({ platform: 'threads', status: 'success', detail: `${(text || '').slice(0, 100)} (recovered after false-error response)` });
        return { recovered: true };
      }
      throw new Error(`Threads publish failed: ${JSON.stringify(publishData)}`);
    }

    await logPost({ platform: 'threads', status: 'success', detail: text ? text.slice(0, 100) : null });
    return publishData;
  } catch (err) {
    await logPost({ platform: 'threads', status: 'failed', detail: err.message });
    throw err;
  }
}

module.exports = { createPost };
