// Shared Facebook Page posting helper, used by scripts/automate.js (article
// posts) and scripts/generate-guide.js (evergreen guide posts).
const { logPost } = require('./postLog');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Meta downranks posts that push people off-platform in the first seconds.
 * Prefer linkPlacement: 'first_comment' for photo posts so the feed unit stays
 * a native photo + discussion prompt, with the destination URL in a comment.
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

/**
 * @param {string} link
 * @param {'article'|'buzz_board'|'guide'} [kind='article']
 */
function firstCommentMessage(link, kind = 'article') {
  if (!link) return '';
  if (kind === 'buzz_board') {
    return `Continue the chat on Buzz Board (saves your answer + joins the community):\n${link}`;
  }
  if (kind === 'guide') {
    return `Full guide:\n${link}`;
  }
  return `Full story:\n${link}`;
}

/**
 * Publish a vertical MP4 as a Facebook Reel (not a regular Page /videos post).
 * Regular /videos uploads of 9:16 files often show letterboxed in feed; Reels
 * stay full-bleed. Uses Meta's 3-step video_reels + rupload file_url flow.
 * @see https://developers.facebook.com/docs/video-api/guides/reels-publishing/
 */
async function publishFacebookReel({
  videoUrl,
  description,
  title = null,
  accessToken = process.env.FB_PAGE_ACCESS_TOKEN,
  pageId = process.env.FB_PAGE_ID,
}) {
  if (!pageId || !accessToken) {
    throw new Error('FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN required for Reel publish');
  }
  if (!videoUrl) throw new Error('videoUrl required for Reel publish');

  const startRes = await fetch(`${GRAPH_BASE}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      upload_phase: 'start',
      access_token: accessToken,
    }),
  });
  const startPayload = await startRes.json().catch(() => ({}));
  if (!startRes.ok || startPayload.error || !startPayload.video_id) {
    throw new Error(`Facebook Reel start failed: ${JSON.stringify(startPayload)}`);
  }

  const videoId = startPayload.video_id;
  const uploadUrl = startPayload.upload_url
    || `https://rupload.facebook.com/video-upload/v19.0/${videoId}`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_url: videoUrl,
    },
  });
  const uploadPayload = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || uploadPayload.error || uploadPayload.success === false) {
    throw new Error(`Facebook Reel upload failed: ${JSON.stringify(uploadPayload)}`);
  }

  const finishBody = {
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: description || '',
    access_token: accessToken,
  };
  if (title) finishBody.title = title;

  const finishRes = await fetch(`${GRAPH_BASE}/${pageId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finishBody),
  });
  const finishPayload = await finishRes.json().catch(() => ({}));
  if (!finishRes.ok || finishPayload.error) {
    throw new Error(`Facebook Reel finish failed: ${JSON.stringify(finishPayload)}`);
  }

  return {
    id: videoId,
    postId: finishPayload.post_id || videoId,
    videoId,
    finish: finishPayload,
  };
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
  linkCommentKind = 'article',
  firstCommentText = null,
  /** When true + videoUrl, publish via /video_reels (vertical Reel) instead of /videos. */
  asReel = false,
  reelTitle = null,
}) {
  const putLinkInFirstComment = linkPlacement === 'first_comment' && Boolean(link);
  const resolveFirstComment = () => firstCommentText || firstCommentMessage(link, linkCommentKind);

  if (dryRun) {
    const linkNote = putLinkInFirstComment
      ? ` (link in first comment: ${link})`
      : (link ? ` (link: ${link})` : '');
    const videoNote = videoUrl
      ? ` (${asReel ? 'reel' : 'video'}: ${videoUrl})`
      : imageUrl ? ` (image: ${imageUrl})` : '';
    console.log(`  [dry-run] Would post to Facebook: "${message}"${linkNote}${videoNote}`);
    return returnResult ? { ok: true, dryRun: true, linkPlacement, asReel: Boolean(asReel && videoUrl) } : true;
  }

  if (videoUrl) {
    const description = putLinkInFirstComment
      ? message
      : (link ? `${message}\n\n${link}` : message);

    let payload;
    if (asReel) {
      try {
        payload = await publishFacebookReel({
          videoUrl,
          description,
          title: reelTitle,
        });
      } catch (err) {
        const errText = err.message || String(err);
        await logPost({ platform: 'facebook', status: 'failed', detail: errText });
        throw err;
      }
    } else {
      const res = await fetch(`${GRAPH_BASE}/${process.env.FB_PAGE_ID}/videos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: videoUrl, description, access_token: process.env.FB_PAGE_ACCESS_TOKEN }),
      });
      payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.error) {
        const errText = JSON.stringify(payload);
        await logPost({ platform: 'facebook', status: 'failed', detail: errText });
        throw new Error(`Facebook video post failed: ${errText}`);
      }
    }

    const postId = payload.postId || payload.id || null;
    let commentId = null;
    if (putLinkInFirstComment && postId) {
      commentId = await commentOnFacebookPost(postId, resolveFirstComment(), process.env.FB_PAGE_ACCESS_TOKEN);
    }
    await logPost({ platform: 'facebook', status: 'success', detail: logDetail || message.slice(0, 100) });
    return returnResult
      ? { ok: true, postId, commentId, linkPlacement, asReel: Boolean(asReel), videoId: payload.videoId || payload.id || null }
      : true;
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
      commentId = await commentOnFacebookPost(postId, resolveFirstComment(), process.env.FB_PAGE_ACCESS_TOKEN);
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
    commentId = await commentOnFacebookPost(payload.id, resolveFirstComment(), process.env.FB_PAGE_ACCESS_TOKEN);
  }

  await logPost({ platform: 'facebook', status: 'success', detail: logDetail || message.slice(0, 100) });
  return returnResult ? { ok: true, postId: payload.id, photoId: null, commentId, linkPlacement } : true;
}

module.exports = {
  postToFacebookPage,
  publishFacebookReel,
  commentOnFacebookPost,
  firstCommentMessage,
};
