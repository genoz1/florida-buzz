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
  PARK_CRUISE_KEYWORDS,
} = require('../lib/facebookDistribution');
const {
  applyFacebookFeedDecision,
  isFacebookCadenceDeferral,
} = require('../lib/facebookFeedQueue');

test('topic filter allows theme-parks and cruises by category', () => {
  assert.equal(isFacebookTopicAllowed({ category: 'theme-parks', title: 'Hours update' }).ok, true);
  assert.equal(isFacebookTopicAllowed({ category: 'cruises', title: 'Port tip' }).ok, true);
});

test('topic filter rejects beaches/space/food unless keywords match', () => {
  assert.equal(
    isFacebookTopicAllowed({ category: 'beaches', title: 'Best shells in Sarasota' }).ok,
    false
  );
  assert.equal(
    isFacebookTopicAllowed({ category: 'space', title: 'Rocket launch viewing tips' }).ok,
    false
  );
  assert.equal(
    isFacebookTopicAllowed({
      category: 'food',
      title: 'Magic Kingdom snack ranking for rope drop',
    }).ok,
    true
  );
  assert.equal(
    isFacebookTopicAllowed({
      category: 'events',
      title: 'Port Canaveral cruise weekend events',
    }).ok,
    true
  );
});

test('topic filter can be disabled with FB_TOPIC_FILTER_ENABLED=false', () => {
  const decision = isFacebookTopicAllowed(
    { category: 'wildlife', title: 'Manatee season' },
    { FB_TOPIC_FILTER_ENABLED: 'false' }
  );
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, 'filter_disabled');
});

test('FB_ALLOWED_CATEGORIES overrides the default allowlist', () => {
  const env = { FB_ALLOWED_CATEGORIES: 'cruises' };
  assert.equal(isFacebookTopicAllowed({ category: 'theme-parks', title: 'Park tip' }, env).ok, false);
  assert.equal(isFacebookTopicAllowed({ category: 'cruises', title: 'Sail tip' }, env).ok, true);
});

test('cadence defaults space posts ~90 minutes without a tight daily drop-cap', () => {
  const config = getFacebookCadenceConfig({});
  assert.equal(config.minHoursBetweenPosts, 1.5);
  assert.equal(config.maxPostsPerDay, 0);
  assert.equal(config.maxPostsPerRun, 1);
  assert.equal(config.postDelayMinutes, 60);
  assert.ok(config.minHoursBetweenPosts >= 1.5 && config.minHoursBetweenPosts <= 2);
});

test('cadence blocks a second Facebook post in the same run', () => {
  const blocked = evaluateFacebookCadence({ postsThisRun: 1, recentSuccesses: [] }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'max_per_run');
  assert.equal(isFacebookCadenceDeferral(blocked.reason), true);
});

test('cadence blocks when last Facebook success was too recent', () => {
  const now = new Date('2026-10-11T18:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T17:00:00.000Z' }]; // 1h ago (< 1.5h)
  const blocked = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'min_spacing');
  assert.equal(isFacebookCadenceDeferral(blocked.reason), true);
});

test('cadence allows a post after the minimum gap', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T18:00:00.000Z' }]; // 2h ago (> default 1.5h)
  const ok = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'cadence_ok');
});

test('default daily max is off so many park posts are not hard-dropped', () => {
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

test('1.5h gap + frequent runs can clear eight park posts in one waking day', () => {
  // Simulate drain ticks every 90 minutes starting 12:00 — eight successes fit before midnight.
  const start = new Date('2026-10-11T16:00:00.000Z'); // noon ET roughly for the story
  const gapMs = 1.5 * 60 * 60 * 1000;
  const successes = [];
  for (let i = 0; i < 8; i += 1) {
    const now = new Date(start.getTime() + i * gapMs);
    const decision = evaluateFacebookCadence(
      { postsThisRun: 0, recentSuccesses: successes, now },
      { FB_MIN_HOURS_BETWEEN_POSTS: '1.5' }
    );
    assert.equal(decision.ok, true, `post ${i + 1} should be allowed at ${now.toISOString()}`);
    successes.unshift({ created_at: now.toISOString() });
  }
  assert.equal(successes.length, 8);
  const last = new Date(successes[0].created_at);
  const hoursSpan = (last.getTime() - start.getTime()) / (60 * 60 * 1000);
  assert.equal(hoursSpan, 10.5, 'eight posts at 1.5h = 10.5h from first to last');
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

test('decideFacebookDistribution combines topic + cadence', async () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const allowed = await decideFacebookDistribution(
    { category: 'theme-parks', title: 'Lightning Lane change' },
    {
      postsThisRun: 0,
      now,
      recentSuccesses: [{ created_at: '2026-10-11T10:00:00.000Z' }],
    }
  );
  assert.equal(allowed.ok, true);

  const filtered = await decideFacebookDistribution(
    { category: 'beaches', title: 'Shelling guide' },
    { postsThisRun: 0, now, recentSuccesses: [] }
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

test('non-article Facebook jobs are skipped by default', () => {
  assert.equal(isNonArticleFacebookAllowed({}).ok, false);
  assert.equal(isNonArticleFacebookAllowed({ FB_SKIP_NON_PARK_FEED: 'false' }).ok, true);
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
  assert.match(docs, /every theme-park and cruise article and guide still posts/i);
  assert.match(docs, /about every 1\.5 hours/i);
  assert.match(docs, /If 8 park posts publish on the site today/i);
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
