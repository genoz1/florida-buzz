// Thin wrapper around Meta's "Instagram API with Instagram Login" for
// publishing a photo post. Unlike the classic Instagram Graph API (which
// requires a linked Facebook Page), this talks to graph.instagram.com
// directly using an Instagram-Login access token — no Page linking needed.
//
// Publishing is a two-step process: create a media "container" pointing at
// an image URL, then publish that container. Containers can take a few
// seconds to process, so we poll their status before publishing.

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

async function createPost({ imageUrl, caption }) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_USER_ID;

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
    throw new Error(`Instagram publish failed: ${JSON.stringify(publishData)}`);
  }

  return publishData;
}

module.exports = { createPost };
