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

test('cadence defaults favor spaced park posts, not bursts', () => {
  const config = getFacebookCadenceConfig({});
  assert.equal(config.minHoursBetweenPosts, 4);
  assert.equal(config.maxPostsPerDay, 2);
  assert.equal(config.maxPostsPerRun, 1);
  assert.equal(config.postDelayMinutes, 60);
  assert.ok(config.postDelayMinutes >= 60);
});

test('cadence blocks a second Facebook post in the same run', () => {
  const blocked = evaluateFacebookCadence({ postsThisRun: 1, recentSuccesses: [] }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'max_per_run');
});

test('cadence blocks when last Facebook success was too recent', () => {
  const now = new Date('2026-10-11T18:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T16:00:00.000Z' }]; // 2h ago
  const blocked = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'min_spacing');
});

test('cadence allows a post after the minimum gap', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [{ created_at: '2026-10-11T15:00:00.000Z' }]; // 5h ago
  const ok = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, 'cadence_ok');
});

test('cadence blocks after max posts in 24h', () => {
  const now = new Date('2026-10-11T20:00:00.000Z');
  const recent = [
    { created_at: '2026-10-11T10:00:00.000Z' },
    { created_at: '2026-10-11T15:00:00.000Z' },
  ];
  const blocked = evaluateFacebookCadence({ postsThisRun: 0, recentSuccesses: recent, now }, {});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'max_per_day');
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

test('non-article Facebook jobs are skipped by default', () => {
  assert.equal(isNonArticleFacebookAllowed({}).ok, false);
  assert.equal(isNonArticleFacebookAllowed({ FB_SKIP_NON_PARK_FEED: 'false' }).ok, true);
});

test('keyword list documents Disney/Universal/cruise coverage', () => {
  assert.ok(PARK_CRUISE_KEYWORDS.includes('disney'));
  assert.ok(PARK_CRUISE_KEYWORDS.includes('universal orlando') || PARK_CRUISE_KEYWORDS.includes('epic universe'));
  assert.ok(PARK_CRUISE_KEYWORDS.includes('cruise') || PARK_CRUISE_KEYWORDS.includes('port canaveral'));
});

test('automate and guide scripts wire the Facebook distribution gate', () => {
  const automate = fs.readFileSync(path.join(__dirname, '../scripts/automate.js'), 'utf8');
  const guide = fs.readFileSync(path.join(__dirname, '../scripts/generate-guide.js'), 'utf8');
  assert.match(automate, /decideFacebookDistribution/);
  assert.match(automate, /facebookPostsThisRun/);
  assert.match(guide, /decideFacebookDistribution/);
  assert.doesNotMatch(automate, /Posts will be spaced \$\{FB_POST_DELAY_MINUTES\} minute\(s\) apart across all platforms/);
});
