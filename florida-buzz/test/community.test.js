const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const { createModerationClassifier, deterministicModeration } = require('../lib/community/moderation');
const { calculateBuzzScore } = require('../lib/community/ranking');
const { createCommunityService } = require('../lib/community/service');
const {
  CommunityError,
  normalizedBodyHash,
  validateCommunityBody,
  validateStarter,
} = require('../lib/community/validation');

const MEMBER = { id: '11111111-1111-4111-8111-111111111111', role: 'member', status: 'active' };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', role: 'member', status: 'active' };
const MODERATOR = { id: '33333333-3333-4333-8333-333333333333', role: 'moderator', status: 'active' };
const ADMIN = { id: '44444444-4444-4444-8444-444444444444', role: 'admin', status: 'active' };
const DISCUSSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RESPONSE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REPLY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function foundation(overrides = {}) {
  const state = {
    responses: [],
    reports: [],
    reactions: new Set(),
    limits: [],
    moderation: [],
    discussions: [],
    targets: new Map([
      [RESPONSE_ID, { id: RESPONSE_ID, discussion_id: DISCUSSION_ID, author_id: OTHER.id, parent_response_id: null, moderation_status: 'published', deleted_at: null }],
      [REPLY_ID, { id: REPLY_ID, discussion_id: DISCUSSION_ID, author_id: OTHER.id, parent_response_id: RESPONSE_ID, moderation_status: 'published', deleted_at: null }],
    ]),
  };
  const store = {
    async getResponse(id) { return state.targets.get(id) || null; },
    async findRecentDuplicate(input) { return state.responses.some((row) => row.authorId === input.authorId && row.bodyHash === input.bodyHash); },
    async createResponse(input) {
      state.responses.push(input);
      return { id: `dddddddd-dddd-4ddd-8ddd-${String(state.responses.length).padStart(12, '0')}`, moderation_status: input.moderationStatus, parent_response_id: input.parentResponseId, created_at: new Date().toISOString() };
    },
    async toggleReaction({ responseId, userId }) {
      const key = `${responseId}:${userId}`;
      if (state.reactions.has(key)) { state.reactions.delete(key); return { liked: false }; }
      state.reactions.add(key); return { liked: true };
    },
    async createReport(input) {
      if (state.reports.some((row) => row.responseId === input.responseId && row.reporterId === input.reporterId)) {
        const error = new Error('duplicate'); error.code = '23505'; throw error;
      }
      state.reports.push(input); return { id: 'report' };
    },
    async createDiscussion(input) { state.discussions.push(input); return { id: DISCUSSION_ID, slug: input.slug }; },
    async moderateResponse(input) { state.moderation.push(input); return { previous_state: 'held', new_state: 'published' }; },
    async moderateDiscussion(input) { state.moderation.push(input); return { previous_state: 'published', new_state: 'locked' }; },
    async moderateProfile(input) { state.moderation.push(input); return { previous_state: 'active', new_state: 'suspended' }; },
    async recordImpression() {},
    ...overrides.store,
  };
  const limiter = overrides.limiter || {
    async consume(namespace, identifier) {
      state.limits.push({ namespace, identifier });
      return { allowed: true, remaining: 9, retryAfterSeconds: 0 };
    },
  };
  const service = createCommunityService({
    store,
    limiter,
    classify: overrides.classify || createModerationClassifier(),
    analyticsKey: Buffer.alloc(32, 7),
    now: () => new Date('2026-10-03T20:00:00Z'),
  });
  return { service, state, store };
}

test('response validation normalizes plain text and rejects HTML, links, and contact solicitation', () => {
  assert.equal(validateCommunityBody('  This   is a thoughtful answer.  '), 'This is a thoughtful answer.');
  assert.throws(() => validateCommunityBody('<b>Try this</b>'), /html_not_allowed/);
  assert.throws(() => validateCommunityBody('Read https://example.com for details'), /links_not_allowed/);
  assert.throws(() => validateCommunityBody('Email me at person@example.com'), /contact_information_not_allowed/);
  assert.throws(() => validateCommunityBody('Call 407-555-1212 please'), /contact_information_not_allowed/);
  assert.equal(normalizedBodyHash('Same answer!'), normalizedBodyHash('same answer'));
});

test('starter validation enforces the four categories and clean slugs', () => {
  assert.deepEqual(validateStarter({
    slug: 'best-disney-snack', question: 'What is the best Disney snack right now?',
    context: 'Tell us what is worth the wait.', topic: 'Park food', category: 'disney',
  }).category, 'disney');
  assert.throws(() => validateStarter({ slug: 'bad slug', question: 'This question is valid enough', topic: 'Topic', category: 'disney' }), /invalid_slug/);
  assert.throws(() => validateStarter({ slug: 'valid-slug', question: 'This question is valid enough', topic: 'Topic', category: 'space' }), /invalid_category/);
});

test('deterministic moderation holds real threats but permits ordinary negative opinions', () => {
  assert.deepEqual(deterministicModeration('Universal has become too expensive and I dislike the new policy.'), { decision: 'publish', signals: [] });
  assert.equal(deterministicModeration('I will attack you after the park closes.').decision, 'hold');
  assert.equal(deterministicModeration('BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW BUY NOW').decision, 'reject');
});

test('provider moderation fails closed to held without making deterministic disagreement unsafe', async () => {
  const classify = createModerationClassifier({ mode: 'provider', provider: async () => { throw new Error('down'); } });
  const result = await classify('I disagree with the price increase, but here is why it matters.');
  assert.equal(result.decision, 'hold');
  assert.deepEqual(result.signals, ['moderation-unavailable']);
});

test('authenticated response publishes, hashes content, and uses both user and IP limits', async () => {
  const { service, state } = foundation();
  const result = await service.submitResponse({ discussionId: DISCUSSION_ID, body: 'The early entry hour made the biggest difference for our family.' }, { user: MEMBER, ip: '198.51.100.10' });
  assert.equal(result.status, 'published');
  assert.equal(state.responses[0].body.includes('<'), false);
  assert.equal(state.responses[0].bodyHash.length, 64);
  assert.deepEqual(state.limits.map((item) => item.namespace), ['community-response-ip', 'community-response-user']);
});

test('responses require authentication and duplicate submissions are rejected', async () => {
  const { service, state } = foundation();
  await assert.rejects(service.submitResponse({ discussionId: DISCUSSION_ID, body: 'This answer has enough useful detail.' }, { user: null, ip: 'x' }), (error) => error.code === 'authentication_required');
  const body = 'This answer has enough useful detail for another reader.';
  await service.submitResponse({ discussionId: DISCUSSION_ID, body }, { user: MEMBER, ip: 'x' });
  await assert.rejects(service.submitResponse({ discussionId: DISCUSSION_ID, body }, { user: MEMBER, ip: 'x' }), (error) => error.code === 'duplicate_content');
  assert.equal(state.responses.length, 1);
});

test('one-level replies are accepted and replies to replies are rejected', async () => {
  const { service, state } = foundation();
  const result = await service.submitResponse({ discussionId: DISCUSSION_ID, parentResponseId: RESPONSE_ID, body: 'That matches what happened on our most recent trip.' }, { user: MEMBER, ip: 'x' });
  assert.equal(result.kind, 'reply');
  await assert.rejects(service.submitResponse({ discussionId: DISCUSSION_ID, parentResponseId: REPLY_ID, body: 'This would create an unwanted third level.' }, { user: MEMBER, ip: 'x' }), (error) => error.code === 'invalid_reply_target');
  assert.equal(state.responses.length, 1);
});

test('held and rejected moderation decisions are persisted without falsely publishing', async () => {
  const held = foundation({ classify: async () => ({ decision: 'hold', signals: ['review'] }) });
  const heldResult = await held.service.submitResponse({ discussionId: DISCUSSION_ID, body: 'This response should receive a manual review.' }, { user: MEMBER, ip: 'x' });
  assert.equal(heldResult.status, 'held');
  assert.equal(held.state.responses[0].moderationStatus, 'held');

  const rejected = foundation({ classify: async () => ({ decision: 'reject', signals: ['spam'] }) });
  const rejectedResult = await rejected.service.submitResponse({ discussionId: DISCUSSION_ID, body: 'This response is deterministic spam content.' }, { user: MEMBER, ip: 'x' });
  assert.equal(rejectedResult.status, 'rejected');
});

test('reaction toggles are unique and reports reject self/duplicate manipulation', async () => {
  const { service, state } = foundation();
  assert.equal((await service.toggleReaction({ responseId: RESPONSE_ID }, { user: MEMBER, ip: 'x' })).liked, true);
  assert.equal((await service.toggleReaction({ responseId: RESPONSE_ID }, { user: MEMBER, ip: 'x' })).liked, false);
  await service.report({ responseId: RESPONSE_ID, reason: 'spam' }, { user: MEMBER, ip: 'x' });
  await assert.rejects(service.report({ responseId: RESPONSE_ID, reason: 'spam' }, { user: MEMBER, ip: 'x' }), (error) => error.code === 'already_reported');
  await assert.rejects(service.report({ responseId: RESPONSE_ID, reason: 'spam' }, { user: OTHER, ip: 'x' }), (error) => error.code === 'cannot_report_own_content');
  assert.equal(state.reports.length, 1);
});

test('members have no discussion creation path and only admins create starters', async () => {
  const { service, state } = foundation();
  const input = { slug: 'best-florida-day', question: 'What makes a perfect Florida day for you?', context: '', topic: 'Florida favorites', category: 'florida-life' };
  await assert.rejects(service.createDiscussion(input, { user: MEMBER, ip: 'x' }), (error) => error.code === 'forbidden');
  await service.createDiscussion(input, { user: ADMIN, ip: 'x' });
  assert.equal(state.discussions.length, 1);
  assert.equal(state.discussions[0].createdBy, ADMIN.id);
});

test('moderation requires staff and profile sanctions require an admin', async () => {
  const { service, state } = foundation();
  await assert.rejects(service.moderateResponse({ responseId: RESPONSE_ID, action: 'approve' }, { user: MEMBER, ip: 'x' }), (error) => error.code === 'forbidden');
  await service.moderateResponse({ responseId: RESPONSE_ID, action: 'approve' }, { user: MODERATOR, ip: 'x' });
  await assert.rejects(service.moderateProfile({ profileId: MEMBER.id, action: 'suspend' }, { user: MODERATOR, ip: 'x' }), (error) => error.code === 'forbidden');
  await service.moderateProfile({ profileId: MEMBER.id, action: 'suspend' }, { user: ADMIN, ip: 'x' });
  assert.equal(state.moderation.length, 2);
});

test('community rate-limit failure fails closed with no content write', async () => {
  const { service, state } = foundation({ limiter: { async consume() { throw new Error('db down'); } } });
  await assert.rejects(service.submitResponse({ discussionId: DISCUSSION_ID, body: 'This is a valid response that must not be written.' }, { user: MEMBER, ip: 'x' }), (error) => error.code === 'security_service_unavailable');
  assert.equal(state.responses.length, 0);
});

test('Buzzing score caps manipulation, requires genuine activity for recency, and revives old threads', () => {
  const now = new Date('2026-10-03T20:00:00Z');
  const empty = calculateBuzzScore({ createdAt: '2026-10-03T18:00:00Z', lastActivityAt: '2026-10-03T18:00:00Z' }, now);
  assert.equal(empty, 3);
  const capped = calculateBuzzScore({ recentParticipants: 999, substantiveResponses: 999, replyThreads: 999, recentLikes: 999, velocity: 999, createdAt: '2026-01-01', lastActivityAt: '2026-10-03T19:00:00Z' }, now);
  const stillCapped = calculateBuzzScore({ recentParticipants: 8, substantiveResponses: 12, replyThreads: 6, recentLikes: 15, velocity: 10, createdAt: '2026-01-01', lastActivityAt: '2026-10-03T19:00:00Z' }, now);
  assert.equal(capped, stillCapped);
  const oldRevived = calculateBuzzScore({ recentParticipants: 3, substantiveResponses: 4, replyThreads: 2, recentLikes: 5, velocity: 3, createdAt: '2025-01-01', lastActivityAt: '2026-10-03T19:30:00Z' }, now);
  assert.ok(oldRevived > empty);
});

test('migration enforces RLS, service-only writes, one reply level, report threshold, and capped ranking', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261003220000_buzz_board_community_core.sql'), 'utf8');
  for (const table of ['discussions', 'responses', 'community_reactions', 'community_reports', 'moderation_actions', 'discussion_impressions']) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /only an admin profile may create a discussion/);
  assert.match(sql, /where user_id = new\.created_by and status = 'active'/);
  assert.match(sql, /replies must target a top-level response in the same discussion/);
  assert.match(sql, /create or replace function public\.is_visible_parent_response/);
  assert.match(sql, /or public\.is_visible_parent_response\(parent_response_id\)/);
  assert.match(sql, /unique \(response_id, reporter_id\)/);
  assert.match(sql, /v_report_count >= 3/);
  assert.match(sql, /moderation_reviewed_at = null/);
  assert.match(sql, /moderation_reviewed_at = clock_timestamp\(\)/);
  assert.match(sql, /least\(a\.recent_participants, 8\)/);
  assert.match(sql, /p\.role = 'member'/);
  assert.match(sql, /reactor\.role = 'member'/);
  assert.match(sql, /revoke all on public\.discussions[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(sql, /create policy[^;]+for insert to authenticated/i);
});

test('discussion view escapes response text and exposes no author identifiers', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/buzz-discussion.ejs'), {
    discussion: {
      id: DISCUSSION_ID, slug: 'test-question', question: 'What is your favorite Florida day?', context: null,
      category: 'florida-life', status: 'published', response_count: 1, unique_participant_count: 1,
      last_activity_at: '2026-10-03T19:00:00Z',
      responses: [{ id: RESPONSE_ID, parentResponseId: null, body: '<script>alert(1)</script>', likeCount: 0, reportCount: 0, createdAt: '2026-10-03T19:00:00Z', displayName: 'Reader', viewerLiked: false, replies: [] }],
    },
    categoryLabels: { 'florida-life': 'Florida Life' },
    timeAgo: () => '1h ago', turnstileSiteKey: '', user: MEMBER,
  }, { filename: path.join(__dirname, '../views/buzz-discussion.ejs') });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, new RegExp(MEMBER.id));
  assert.match(html, /noindex,follow/);
});

test('browser analytics sends only allowlisted state and never community content or identity', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/js/buzz-board.js'), 'utf8');
  const pushes = [...script.matchAll(/analytics\(([^\n]+)\)/g)].map((match) => match[1]);
  assert.ok(pushes.length >= 6);
  assert.doesNotMatch(script, /analytics\([^\n]*(?:body|email|displayName|userId|responseId|discussionId)/);
  assert.doesNotMatch(script, /dataLayer\.push\([^\n]*(?:body|email|displayName|userId|responseId|discussionId)/);
  assert.match(script, /analytics\('buzz_filter_select', \{ filter:/);
  assert.match(script, /analytics\('buzz_report', \{ reason:/);
});

test('private moderation view includes report context and audited response, discussion, and account actions', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/buzz-moderation.ejs'), {
    queue: [{
      id: RESPONSE_ID,
      author_id: MEMBER.id,
      author_display_name: 'Reader',
      body: 'A response awaiting review.',
      moderation_status: 'held',
      moderation_signals: ['report-threshold'],
      report_count: 3,
      created_at: '2026-10-03T19:00:00Z',
      discussion: { id: DISCUSSION_ID, slug: 'test-question', question: 'What is your favorite Florida day?', status: 'published' },
      reports: [{ reason: 'other', details: '<private detail>' }],
    }],
    category: null,
    isBuzzPage: true,
    timeAgo: () => '1h ago',
    user: ADMIN,
  }, { filename: path.join(__dirname, '../views/buzz-moderation.ejs') });
  assert.match(html, /data-community-form="moderation"/);
  assert.match(html, /data-community-form="discussion-moderation"/);
  assert.match(html, /data-community-form="profile-moderation"/);
  assert.match(html, /&lt;private detail&gt;/);
  assert.match(html, /noindex,nofollow/);
});
