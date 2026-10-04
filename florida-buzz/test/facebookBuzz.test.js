const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  facebookCommentEvents,
  moderateFacebookComment,
  normalizeFacebookComment,
  normalizeFacebookPublishResult,
  saveFacebookPostMapping,
  verifyFacebookSignature,
} = require('../lib/facebookBuzz');

test('Facebook publishing result retains both Page post and photo IDs', () => {
  assert.deepEqual(normalizeFacebookPublishResult({ post_id: 'page_post', id: 'photo' }), {
    postId: 'page_post', photoId: 'photo', permalinkUrl: null,
  });
});

test('Facebook post mapping is persisted against its Buzz Board discussion', async () => {
  let written;
  const chain = {
    upsert(value, options) { written = { value, options }; return chain; },
    select() { return chain; },
    async single() { return { data: { discussion_id: written.value.discussion_id, facebook_post_id: written.value.facebook_post_id }, error: null }; },
  };
  const client = { from(table) { assert.equal(table, 'facebook_buzz_posts'); return chain; } };
  const result = await saveFacebookPostMapping(client, {
    discussionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    publishResult: { postId: 'page_post', photoId: 'photo' },
    publishedAt: new Date('2026-10-04T12:00:00Z'),
  });
  assert.equal(result.facebook_post_id, 'page_post');
  assert.equal(written.options.onConflict, 'discussion_id');
});

test('Facebook comment moderation publishes ordinary discussion but holds links and contact data', () => {
  assert.equal(moderateFacebookComment('Universal hotel access saved our family nearly an hour each day.').status, 'published');
  assert.equal(moderateFacebookComment('Email me at person@example.com').status, 'held');
  assert.equal(moderateFacebookComment('See https://example.com').status, 'held');
  assert.equal(moderateFacebookComment('BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW').status, 'rejected');
});

test('Facebook replies retain source identity and parent relationship without creating a member', () => {
  const comment = normalizeFacebookComment({
    id: 'comment-2',
    parent: { id: 'comment-1' },
    message: 'That was our experience too, especially at park close.',
    from: { id: 'page-scoped-1', name: 'Florida Reader' },
    created_time: '2026-10-04T12:00:00Z',
  });
  assert.equal(comment.parentId, 'comment-1');
  assert.equal(comment.commenterName, 'Florida Reader');
  assert.equal(comment.commenterId, 'page-scoped-1');
});

test('Meta webhook signature is validated with constant-time HMAC comparison', () => {
  const body = Buffer.from('{"object":"page"}');
  const secret = 'test-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(verifyFacebookSignature(body, signature, secret), true);
  assert.equal(verifyFacebookSignature(body, `${signature.slice(0, -1)}0`, secret), false);
});

test('Page feed webhook extracts genuine comment add/edit/remove events only', () => {
  const events = facebookCommentEvents({
    object: 'page',
    entry: [{ changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', post_id: 'page_post', comment_id: 'c1', message: 'Useful answer' } },
      { field: 'feed', value: { item: 'post', verb: 'add', post_id: 'ignored' } },
    ] }],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].postId, 'page_post');
  assert.equal(events[0].comment.id, 'c1');
});

test('migration keeps Facebook mappings and imported comments service-only', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../supabase/migrations/20261004170000_facebook_buzz_conversation.sql'), 'utf8');
  assert.match(sql, /create table public\.facebook_buzz_posts/);
  assert.match(sql, /create table public\.facebook_buzz_comments/);
  assert.match(sql, /facebook_comment_id text not null unique/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant all on public\.facebook_buzz_posts, public\.facebook_buzz_comments\s+to service_role/);
  assert.doesNotMatch(sql, /create policy/);
});
