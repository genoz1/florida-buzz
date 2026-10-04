const crypto = require('node:crypto');
const { deterministicModeration } = require('./community/moderation');
const {
  hasEmail,
  hasPhone,
  hasUrl,
  normalizePlainText,
} = require('./community/validation');

const GRAPH_VERSION = process.env.FB_GRAPH_API_VERSION || 'v19.0';
const GRAPH_ORIGIN = 'https://graph.facebook.com';

function graphError(payload, fallback = 'Facebook Graph API request failed.') {
  const error = new Error(payload?.error?.message || fallback);
  error.code = payload?.error?.code || 'facebook_graph_error';
  error.type = payload?.error?.type || null;
  return error;
}

function normalizeFacebookPublishResult(result) {
  if (!result || result === true) return null;
  const postId = String(result.postId || result.post_id || result.id || '').trim();
  if (!postId) return null;
  return {
    postId,
    photoId: String(result.photoId || result.photo_id || result.id || '').trim() || null,
    permalinkUrl: typeof result.permalinkUrl === 'string' ? result.permalinkUrl : null,
  };
}

async function saveFacebookPostMapping(client, { discussionId, publishResult, publishedAt = new Date() }) {
  const normalized = normalizeFacebookPublishResult(publishResult);
  if (!normalized) throw new Error('Facebook did not return a usable post ID.');
  const { data, error } = await client.from('facebook_buzz_posts').upsert({
    discussion_id: discussionId,
    facebook_post_id: normalized.postId,
    facebook_photo_id: normalized.photoId,
    permalink_url: normalized.permalinkUrl,
    status: 'active',
    published_at: publishedAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'discussion_id' }).select('discussion_id, facebook_post_id').single();
  if (error) throw new Error(`Could not retain Facebook post mapping: ${error.message}`);
  return data;
}

function moderateFacebookComment(value) {
  const body = normalizePlainText(value).slice(0, 8000);
  if (!body) return { body: null, status: 'removed', signals: ['empty-or-unavailable'] };
  const moderation = deterministicModeration(body);
  const signals = [...moderation.signals];
  if (hasEmail(body) || hasPhone(body)) signals.push('personal-information');
  if (hasUrl(body)) signals.push('external-link');
  const status = moderation.decision === 'reject'
    ? 'rejected'
    : moderation.decision === 'hold' || signals.includes('personal-information') || signals.includes('external-link')
      ? 'held'
      : 'published';
  return { body, status, signals: [...new Set(signals)] };
}

function safeIdentity(from) {
  const name = normalizePlainText(from?.name).slice(0, 120) || null;
  const id = typeof from?.id === 'string' ? from.id.slice(0, 240) : null;
  return { name, id };
}

function normalizeFacebookComment(comment) {
  const id = String(comment?.id || comment?.comment_id || '').trim();
  if (!id) throw new Error('Facebook comment ID is required.');
  const parentId = String(comment?.parent?.id || comment?.parent_id || '').trim() || null;
  const identity = safeIdentity(comment?.from);
  const moderated = moderateFacebookComment(comment?.message);
  const isHidden = comment?.is_hidden === true;
  return {
    id,
    parentId,
    body: moderated.body,
    commenterName: identity.name,
    commenterId: identity.id,
    permalinkUrl: typeof comment?.permalink_url === 'string' ? comment.permalink_url : null,
    moderationStatus: isHidden ? 'removed' : moderated.status,
    moderationSignals: isHidden ? [...moderated.signals, 'hidden-on-facebook'] : moderated.signals,
    isHidden,
    createdAt: comment?.created_time || null,
    updatedAt: comment?.updated_time || comment?.created_time || null,
  };
}

async function upsertFacebookComment(client, mapping, rawComment) {
  const comment = normalizeFacebookComment(rawComment);
  const now = new Date().toISOString();
  const { error } = await client.from('facebook_buzz_comments').upsert({
    facebook_comment_id: comment.id,
    facebook_post_id: mapping.facebook_post_id,
    discussion_id: mapping.discussion_id,
    parent_facebook_comment_id: comment.parentId,
    body: comment.body,
    commenter_name: comment.commenterName,
    commenter_page_scoped_id: comment.commenterId,
    permalink_url: comment.permalinkUrl,
    moderation_status: comment.moderationStatus,
    moderation_signals: comment.moderationSignals,
    is_hidden: comment.isHidden,
    is_deleted: false,
    facebook_created_at: comment.createdAt,
    facebook_updated_at: comment.updatedAt,
    synchronized_at: now,
    updated_at: now,
  }, { onConflict: 'facebook_comment_id' });
  if (error) throw new Error(`Could not save Facebook comment: ${error.message}`);
  return comment.id;
}

async function tombstoneFacebookComment(client, commentId, signal = 'deleted-on-facebook') {
  const now = new Date().toISOString();
  const { error } = await client.from('facebook_buzz_comments').update({
    moderation_status: 'removed',
    moderation_signals: [signal],
    is_deleted: true,
    body: null,
    commenter_name: null,
    commenter_page_scoped_id: null,
    synchronized_at: now,
    updated_at: now,
  }).eq('facebook_comment_id', commentId);
  if (error) throw new Error(`Could not tombstone Facebook comment: ${error.message}`);
}

async function fetchGraphJson(url, token, fetchImpl = fetch) {
  const parsed = new URL(url, GRAPH_ORIGIN);
  if (parsed.origin !== GRAPH_ORIGIN) throw new Error('Refusing a non-Meta pagination URL.');
  parsed.searchParams.set('access_token', token);
  const response = await fetchImpl(parsed, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw graphError(payload);
  return payload;
}

async function fetchAllFacebookComments(postId, { token, fetchImpl = fetch, maxPages = 10 } = {}) {
  if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN is required.');
  const fields = 'id,message,created_time,updated_time,from,parent,permalink_url,is_hidden';
  let next = `${GRAPH_ORIGIN}/${GRAPH_VERSION}/${encodeURIComponent(postId)}/comments?fields=${encodeURIComponent(fields)}&filter=stream&limit=100`;
  const comments = [];
  let complete = true;
  for (let page = 0; next && page < maxPages; page += 1) {
    const payload = await fetchGraphJson(next, token, fetchImpl);
    comments.push(...(payload.data || []));
    next = payload.paging?.next || null;
    if (next && page === maxPages - 1) complete = false;
  }
  return { comments, complete };
}

async function reconcileFacebookPost(client, mapping, options = {}) {
  const { comments, complete } = await fetchAllFacebookComments(mapping.facebook_post_id, options);
  const seen = [];
  for (const comment of comments) seen.push(await upsertFacebookComment(client, mapping, comment));

  if (complete) {
    let query = client.from('facebook_buzz_comments').update({
      moderation_status: 'removed',
      moderation_signals: ['unavailable-on-facebook'],
      is_deleted: true,
      body: null,
      commenter_name: null,
      commenter_page_scoped_id: null,
      synchronized_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('facebook_post_id', mapping.facebook_post_id).eq('is_deleted', false);
    if (seen.length) query = query.not('facebook_comment_id', 'in', `(${seen.join(',')})`);
    const { error } = await query;
    if (error) throw new Error(`Could not reconcile unavailable Facebook comments: ${error.message}`);
  }

  const { error: postError } = await client.from('facebook_buzz_posts').update({
    last_reconciled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('facebook_post_id', mapping.facebook_post_id);
  if (postError) throw new Error(`Could not update Facebook reconciliation state: ${postError.message}`);
  return { imported: seen.length, complete };
}

async function reconcileAllFacebookPosts(client, options = {}) {
  const { data, error } = await client.from('facebook_buzz_posts')
    .select('discussion_id, facebook_post_id')
    .eq('status', 'active')
    .order('last_reconciled_at', { ascending: true, nullsFirst: true })
    .limit(options.limit || 25);
  if (error) throw new Error(`Could not load Facebook post mappings: ${error.message}`);
  const results = [];
  for (const mapping of data || []) {
    results.push({ facebookPostId: mapping.facebook_post_id, ...(await reconcileFacebookPost(client, mapping, options)) });
  }
  return results;
}

function verifyFacebookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !secret || !/^sha256=[a-f0-9]{64}$/i.test(signature || '')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function facebookCommentEvents(payload) {
  if (payload?.object !== 'page' || !Array.isArray(payload.entry)) return [];
  const events = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      const value = change?.value || {};
      if (change?.field !== 'feed' || value.item !== 'comment' || !value.comment_id) continue;
      events.push({
        verb: value.verb,
        postId: String(value.post_id || '').trim(),
        comment: {
          id: value.comment_id,
          parent_id: value.parent_id,
          message: value.message,
          from: value.from,
          created_time: value.created_time ? new Date(Number(value.created_time) * 1000).toISOString() : null,
        },
      });
    }
  }
  return events;
}

async function processFacebookWebhook(client, payload) {
  const events = facebookCommentEvents(payload);
  for (const event of events) {
    if (event.verb === 'remove') {
      await tombstoneFacebookComment(client, event.comment.id);
      continue;
    }
    if (!event.postId) continue;
    const { data: mapping, error } = await client.from('facebook_buzz_posts')
      .select('discussion_id, facebook_post_id')
      .eq('facebook_post_id', event.postId)
      .maybeSingle();
    if (error) throw new Error(`Could not match Facebook webhook post: ${error.message}`);
    if (mapping) await upsertFacebookComment(client, mapping, event.comment);
  }
  return { processed: events.length };
}

module.exports = {
  facebookCommentEvents,
  fetchAllFacebookComments,
  moderateFacebookComment,
  normalizeFacebookComment,
  normalizeFacebookPublishResult,
  processFacebookWebhook,
  reconcileAllFacebookPosts,
  reconcileFacebookPost,
  saveFacebookPostMapping,
  tombstoneFacebookComment,
  upsertFacebookComment,
  verifyFacebookSignature,
};
