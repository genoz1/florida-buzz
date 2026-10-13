'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  decideFacebookDistribution,
  evaluateFacebookCadence,
  getFacebookCadenceConfig,
  isFacebookTopicAllowed,
  isNonArticleFacebookAllowed,
  isParkCruiseTopic,
  PARK_CRUISE_KEYWORDS,
} = require('../lib/facebookDistribution');
const {
  applyFacebookFeedDecision,
  isFacebookCadenceDeferral,
} = require('../lib/facebookFeedQueue');

test('feed topic filter is off by default so every article/guide can post', () => {
  assert.equal(isFacebookTopicAllowed({ category: 'beaches', title: 'Best shells in Sarasota' }).ok, true);
  assert.equal(isFacebookTopicAllowed({ category: 'wildlife', title: 'Manatee season' }).ok, true);
  assert.equal(isFacebookTopicAllowed({ category: 'theme-parks', title: 'Hours update' }).ok, true);
  assert.equal(isFacebookTopicAllowed({ category: 'beaches', title: 'Shells' }).reason, 'filter_disabled');
});

test('optional park/cruise topic filter can be enabled', () => {
  const env = { FB_TOPIC_FILTER_ENABLED: 'true' };
  assert.equal(isFacebookTopicAllowed({ category: 'theme-parks', title: 'Hours update' }, env).ok, true);
  assert.equal(isFacebookTopicAllowed({ category: 'cruises', title: 'Port tip' }, env).ok, true);
  assert.equal(
    isFacebookTopicAllowed({ category: 'beaches', title: 'Best shells in Sarasota' }, env).ok,
    false
  );
  assert.equal(
    isFacebookTopicAllowed({ category: 'space', title: 'Rocket launch viewing tips' }, env).ok,
    false
  );
  assert.equal(
    isFacebookTopicAllowed({
      category: 'food',
      title: 'Magic Kingdom snack ranking for rope drop',
    }, env).ok,
    true
  );
  assert.equal(
    isFacebookTopicAllowed({
      category: 'events',
      title: 'Port Canaveral cruise weekend events',
    }, env).ok,
    true
  );
});

test('isParkCruiseTopic always applies the park/cruise allowlist for Reels', () => {
  assert.equal(isParkCruiseTopic({ category: 'theme-parks', title: 'Park tip' }).ok, true);
  assert.equal(isParkCruiseTopic({ category: 'beaches', title: 'Shelling guide' }).ok, false);
  // Even when feed filter is explicitly off, Reels helper stays park/cruise-only.
  assert.equal(
    isParkCruiseTopic(
      { category: 'wildlife', title: 'Manatees' },
      { FB_TOPIC_FILTER_ENABLED: 'false' }
    ).ok,
    false
  );
});

test('FB_ALLOWED_CATEGORIES overrides the default allowlist when filter is on', () => {
  const env = { FB_TOPIC_FILTER_ENABLED: 'true', FB_ALLOWED_CATEGORIES: 'cruises' };
  assert.equal(isFacebookTopicAllowed({ category: 'theme-parks', title: 'Park tip' }, env).ok, false);
  assert.equal(isFacebookTopicAllowed({ category: 'cruises', title: 'Sail tip' }, env).ok, true);
});

test('cadence defaults space posts ~30 minutes without a tight daily drop-cap', () => {
  const config = getFacebookCadenceConfig({});
  assert.equal(config.minHoursBetweenPosts, 0.5);
  assert.equal(config.maxPostsPerDay, 0);
  assert.equal(config.maxPostsPerRun, 1);
  assert.equal(config.postDelayMinutes, 60);
  assert.ok(config.minHoursBetweenPosts >= 0.5 && config.minHoursBetweenPosts <= 1);
});

test('cadence blocks a second Facebook post in the same run', () => {
  const blocked = evaluateFacebookCadence({ postsThisRun: 1, recentSuccesses: [] }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'max_per_run');
  assert.equal(isFacebookCadenceDeferral(blocked.reason), true);
});

test('cadence blocks when last Facebook success was too recent', () => {
  const now = new Date('2026-10-11T18:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T17:45:00.000Z' }]; // 15 min ago (< 0.5h)
  const blocked = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'min_spacing');
  assert.equal(isFacebookCadenceDeferral(blocked.reason), true);
});

test('cadence allows a post after the minimum gap', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T19:25:00.000Z' }]; // 35 min ago (> default 0.5h)
  const ok = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'cadence_ok');
});

test('default daily max is off so many posts are not hard-dropped', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [
    { created_at: '2026-10-11T08:00:00.000Z' },
    { created_at: '2026-10-11T11:00:00.000Z' },
    { created_at: '2026-10-11T14:00:00.000Z' },
    { created_at: '2026-10-11T17:00:00.000Z' },
  ];
  // Last success was 3h ago — spacing ok, and no daily cap by default.
  const ok = evaluateFacebookCadence(
    { postsThisRun: 0, recentSuccesses: recent, now },
    {}
  );
  assert.equal(ok.ok, true);
});

test('0.5h gap + frequent runs can clear many posts across a waking day', () => {
  const start = new Date('2026-10-11T12:00:00.000Z');
  const gapMs = 0.5 * 60 * 60 * 1000;
  const successes = [];
  for (let i = 0; i < 16; i += 1) {
    const now = new Date(start.getTime() + i * gapMs);
    const decision = evaluateFacebookCadence(
      { postsThisRun: 0, recentSuccesses: successes, now },
      { FB_MIN_HOURS_BETWEEN_POSTS: '0.5' }
    );
    assert.equal(decision.ok, true, `post ${i + 1} should be allowed at ${now.toISOString()}`);
    successes.unshift({ created_at: now.toISOString() });
  }
  assert.equal(successes.length, 16);
  const last = new Date(successes[0].created_at);
  const hoursSpan = (last.getTime() - start.getTime()) / (60 * 60 * 1000);
  assert.equal(hoursSpan, 7.5, 'sixteen posts at 0.5h = 7.5h from first to last');
});

test('optional FB_MAX_POSTS_PER_DAY still defers rather than implying a permanent skip', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [
    { created_at: '2026-10-11T10:00:00.000Z' },
    { created_at: '2026-10-11T15:00:00.000Z' },
  ];
  const blocked = evaluateFacebookCadence(
    { postsThisRun: 0, recentSuccesses: recent, now },
    { FB_MAX_POSTS_PER_DAY: '2' }
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'max_per_day');
  assert.equal(isFacebookCadenceDeferral(blocked.reason), true);
  assert.match(blocked.detail, /queued/i);
});

test('decideFacebookDistribution allows all topics by default and still enforces cadence', async () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const allowed = await decideFacebookDistribution(
    { category: 'beaches', title: 'Shelling guide' },
    {
      postsThisRun: 0,
      now,
      recentSuccesses: [{ created_at: '2026-10-11T10:00:00.000Z' }],
    }
  );
  assert.equal(allowed.ok, true);

  const filtered = await decideFacebookDistribution(
    { category: 'beaches', title: 'Shelling guide' },
    {
      postsThisRun: 0,
      now,
      recentSuccesses: [],
      env: { FB_TOPIC_FILTER_ENABLED: 'true' },
    }
  );
  assert.equal(filtered.ok, false);
  assert.equal(filtered.reason, 'topic_filtered');
});

test('applyFacebookFeedDecision skips topics permanently and defers cadence', async () => {
  const updates = [];
  const client = {
    from() {
      return {
        update(payload) {
          updates.push(payload);
          return {
            eq() {
              return { error: null };
            },
          };
        },
      };
    },
  };

  const skip = await applyFacebookFeedDecision(
    client,
    'beach-shells',
    { ok: false, reason: 'topic_filtered', detail: 'not park' },
    { logger: { log() {}, error() {} } }
  );
  assert.equal(skip.action, 'skipped');
  assert.deepEqual(updates[0], { fb_posted: true });

  const defer = await applyFacebookFeedDecision(
    client,
    'magic-kingdom-tip',
    { ok: false, reason: 'min_spacing', detail: 'wait' },
    { logger: { log() {}, error() {} } }
  );
  assert.equal(defer.action, 'deferred');
  assert.equal(updates.length, 1, 'cadence deferral must not mark fb_posted');

  const post = await applyFacebookFeedDecision(
    client,
    'epic-universe-tip',
    { ok: true, reason: 'allowed' },
    { logger: { log() {}, error() {} } }
  );
  assert.equal(post.action, 'post');
});

test('non-article Facebook jobs are allowed by default', () => {
  assert.equal(isNonArticleFacebookAllowed({}).ok, true);
  assert.equal(isNonArticleFacebookAllowed({ FB_SKIP_NON_PARK_FEED: 'true' }).ok, false);
});

test('keyword list documents Disney/Universal/cruise coverage', () => {
  assert.ok(PARK_CRUISE_KEYWORDS.includes('disney'));
  assert.ok(PARK_CRUISE_KEYWORDS.includes('universal orlando') || PARK_CRUISE_KEYWORDS.includes('epic universe'));
  assert.ok(PARK_CRUISE_KEYWORDS.includes('cruise') || PARK_CRUISE_KEYWORDS.includes('port canaveral'));
});

test('automate, guide, and drain scripts queue Facebook posts instead of permanently skipping cadence', () => {
  const automate = fs.readFileSync(path.join(__dirname, '../scripts/automate.js'), 'utf8');
  const guide = fs.readFileSync(path.join(__dirname, '../scripts/generate-guide.js'), 'utf8');
  const drain = fs.readFileSync(path.join(__dirname, '../scripts/facebook-feed-drain.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const docs = fs.readFileSync(path.join(__dirname, '../docs/facebook-reels-strategy.md'), 'utf8');
  const distribution = fs.readFileSync(path.join(__dirname, '../lib/facebookDistribution.js'), 'utf8');
  assert.match(automate, /decideFacebookDistribution/);
  assert.match(automate, /facebookPostsThisRun/);
  assert.match(automate, /loadPendingFacebookFeedPosts/);
  assert.match(automate, /applyFacebookFeedDecision/);
  assert.match(automate, /markFacebookFeedResolved/);
  assert.match(guide, /decideFacebookDistribution/);
  assert.match(guide, /loadPendingFacebookFeedPosts/);
  assert.match(guide, /applyFacebookFeedDecision/);
  assert.match(drain, /loadPendingFacebookFeedPosts/);
  assert.match(drain, /decideFacebookDistribution/);
  assert.match(drain, /markFacebookFeedResolved/);
  assert.match(server, /FACEBOOK_FEED_DRAIN_CRONS/);
  assert.match(server, /facebook-feed-drain\.js/);
  assert.match(distribution, /FB_TOPIC_FILTER_ENABLED === 'true'/);
  assert.match(docs, /every article and guide/i);
  assert.match(docs, /about every 30 minutes|~30 min/i);
  assert.doesNotMatch(automate, /Posts will be spaced \$\{FB_POST_DELAY_MINUTES\} minute\(s\) apart across all platforms/);
});

test('fb_posted backfill migration prevents re-queuing the back catalog', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/20261012010000_facebook_feed_queue_backfill.sql'),
    'utf8'
  );
  assert.match(migration, /update public\.articles/i);
  assert.match(migration, /fb_posted\s*=\s*true/i);
});
