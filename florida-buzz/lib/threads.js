// Thin wrapper around Meta's Threads API for publishing a text+image post.
// Built on the same underlying Graph API infrastructure as Instagram, so it
// uses the same two-step pattern: create a media container, then publish it.

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

async function createPost({ text, imageUrl }) {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;

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
    throw new Error(`Threads publish failed: ${JSON.stringify(publishData)}`);
  }

  return publishData;
}

module.exports = { createPost };
