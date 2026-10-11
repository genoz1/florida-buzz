// Shared Facebook Page posting helper, used by scripts/automate.js (article
// posts) and scripts/generate-guide.js (evergreen guide posts).
const { logPost } = require('./postLog');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Meta downranks posts that push people off-platform in the first seconds.
 * For engagement posts, put the destination URL in a first comment instead
 * of the caption so the feed unit stays a native photo + discussion prompt.
 * @param {'caption'|'first_comment'} linkPlacement
 */
async function commentOnFacebookPost(postId, message, accessToken) {
  if (!postId || !message) return null;
  const res = await fetch(`${GRAPH_BASE}/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      access_token: accessToken,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.error) {
    console.error(`  [warn] Facebook first-comment failed: ${JSON.stringify(payload)}`);
    return null;
  }
  return payload.id || null;
}

function firstCommentMessage(link) {
  return `Continue the chat on Buzz Board (saves your answer + joins the community):\n${link}`;
}

async function postToFacebookPage({
  message,
  link,
  imageUrl,
  videoUrl,
  dryRun = false,
  logDetail = null,
  returnResult = false,
  linkPlacement = 'caption',
}) {
  const putLinkInFirstComment = linkPlacement === 'first_comment' && Boolean(link);

  if (dryRun) {
    const linkNote = putLinkInFirstComment
      ? ` (link in first comment: ${link})`
      : (link ? ` (link: ${link})` : '');
    console.log(`  [dry-run] Would post to Facebook: "${message}"${linkNote}${videoUrl ? ` (video: ${videoUrl})` : imageUrl ? ` (image: ${imageUrl})` : ''}`);
    return returnResult ? { ok: true, dryRun: true, linkPlacement } : true;
  }

  if (videoUrl) {
    const description = putLinkInFirstComment
      ? message
      : (link ? `${message}\n\n${link}` : message);
    const res = await fetch(`${GRAPH_BASE}/${process.env.FB_PAGE_ID}/videos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: videoUrl, description, access_token: process.env.FB_PAGE_ACCESS_TOKEN }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.error) {
      const errText = JSON.stringify(payload);
      await logPost({ platform: 'facebook', status: 'failed', detail: errText });
      throw new Error(`Facebook video post failed: ${errText}`);
    }
    let commentId = null;
    if (putLinkInFirstComment && payload.id) {
      commentId = await commentOnFacebookPost(payload.id, firstCommentMessage(link), process.env.FB_PAGE_ACCESS_TOKEN);
    }
    await logPost({ platform: 'facebook', status: 'success', detail: logDetail || message.slice(0, 100) });
    return returnResult ? { ok: true, postId: payload.id, commentId, linkPlacement } : true;
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
    const caption = putLinkInFirstComment
      ? message
      : (link ? `${message}\n\n${link}` : message);
    const res = await fetch(`${GRAPH_BASE}/${process.env.FB_PAGE_ID}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        caption,
        access_token: process.env.FB_PAGE_ACCESS_TOKEN,
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.error) {
      const errText = JSON.stringify(payload);
      console.error(`  [error] Facebook photo post failed: ${errText}`);
      await logPost({ platform: 'facebook', status: 'failed', detail: errText });
      return false;
    }

    const postId = payload.post_id || payload.id;
    let commentId = null;
    if (putLinkInFirstComment && postId) {
      commentId = await commentOnFacebookPost(postId, firstCommentMessage(link), process.env.FB_PAGE_ACCESS_TOKEN);
    }

    await logPost({ platform: 'facebook', status: 'success', detail: logDetail || message.slice(0, 100) });
    if (!returnResult) return true;
    return {
      ok: true,
      postId,
      photoId: payload.id || null,
      commentId,
      linkPlacement,
    };
  }

  // No image available for this post (e.g. engagement posts, or a fallback
  // if image storage failed upstream) — fall back to the original link-only
  // post, same behavior as before. first_comment only works when we already
  // have a native post id, so bare link posts keep the link on the post.
  const body = {
    message: putLinkInFirstComment ? message : message,
    access_token: process.env.FB_PAGE_ACCESS_TOKEN,
  };
  if (link && !putLinkInFirstComment) body.link = link;

  const res = await fetch(`${GRAPH_BASE}/${process.env.FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.error) {
    const errText = JSON.stringify(payload);
    console.error(`  [error] Facebook post failed: ${errText}`);
    await logPost({ platform: 'facebook', status: 'failed', detail: errText });
    return false;
  }

  let commentId = null;
  if (putLinkInFirstComment && payload.id) {
    commentId = await commentOnFacebookPost(payload.id, firstCommentMessage(link), process.env.FB_PAGE_ACCESS_TOKEN);
  }

  await logPost({ platform: 'facebook', status: 'success', detail: logDetail || message.slice(0, 100) });
  return returnResult ? { ok: true, postId: payload.id, photoId: null, commentId, linkPlacement } : true;
}

module.exports = { postToFacebookPage, commentOnFacebookPost, firstCommentMessage };
