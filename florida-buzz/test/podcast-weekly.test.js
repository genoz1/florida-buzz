'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { weekKeyEt, matchesGenerateSlot, partsInTimezone, describeSchedule } = require('../lib/podcasts/timeEt');
const { pickEvergreenTopic, EVERGREEN_TOPICS } = require('../lib/podcasts/evergreenTopics');
const { paraphraseQuestion, isDisneyArticle } = require('../lib/podcasts/sourceCollector');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const {
  createWeeklyDraft,
  buildShowNotesHtml,
  buildEpisodeCopy,
  defaultSettings,
  releaseSlotsFromSettings,
  stripPartLabels,
  splitSourcesForEpisodes,
} = require('../lib/podcasts/weeklyDraft');
const { config } = require('../lib/podcasts/config');

test('Eastern week key and Thursday 7pm slot matching', () => {
  const thursday7 = new Date('2026-10-08T23:05:00.000Z'); // 7:05pm EDT
  const parts = partsInTimezone(thursday7);
  assert.equal(parts.weekday, 4);
  assert.equal(parts.hour, 19);
  assert.ok(weekKeyEt(thursday7).startsWith('2026-W'));
  assert.equal(
    matchesGenerateSlot({ timezone: 'America/New_York', generate_weekday: 4, generate_hour: 19, generate_minute: 0 }, thursday7),
    true
  );
  assert.equal(
    matchesGenerateSlot({ timezone: 'America/New_York', generate_weekday: 4, generate_hour: 19, generate_minute: 0 }, new Date('2026-10-08T12:00:00.000Z')),
    false
  );
});

test('schedule labels describe Tuesday and Friday standalone release intent', () => {
  const labels = describeSchedule(defaultSettings());
  assert.match(labels.publishLabel, /Tuesday/i);
  assert.match(labels.publishLabel, /Friday/i);
  assert.match(labels.publishLabel, /standalone/i);
  assert.match(labels.publishSlotALabel, /Tuesday/i);
  assert.match(labels.publishSlotBLabel, /Friday/i);
  assert.doesNotMatch(labels.publishLabel, /Part\s*1/i);
});

test('release slots default to Tuesday then Friday', () => {
  const slots = releaseSlotsFromSettings(defaultSettings(), { PODCASTS_EPISODES_PER_WEEK: '2' });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].weekday, 2);
  assert.equal(slots[0].label, 'Tuesday');
  assert.equal(slots[0].key, 'tue');
  assert.equal(slots[1].weekday, 5);
  assert.equal(slots[1].label, 'Friday');
  assert.equal(slots[1].key, 'fri');
});

test('stripPartLabels removes multi-part packaging language', () => {
  assert.equal(stripPartLabels('Magic Kingdom tips (Part 1)'), 'Magic Kingdom tips');
  assert.equal(stripPartLabels('EPCOT food Part 2 of 2'), 'EPCOT food');
  assert.doesNotMatch(stripPartLabels('Planning talk Part one'), /Part/i);
});

test('buildEpisodeCopy never emits Part 1/Part 2 titles', async () => {
  const copy = await buildEpisodeCopy({
    aiText: {
      async generateText() {
        return 'TITLE: Rope drop myths (Part 1)\nDESCRIPTION: Part 2 comes Friday with more park talk.';
      },
    },
    weekKey: '2026-W41',
    collection: {
      sources: [{ source_kind: 'article', title: 'Is rope drop still worth it?' }],
    },
    releaseSlot: { key: 'tue', label: 'Tuesday', weekday: 2, hour: 6, minute: 0 },
  });
  assert.doesNotMatch(copy.title, /Part\s*1/i);
  assert.doesNotMatch(copy.description, /Part\s*2/i);
  assert.equal(copy.release_slot, 'tue');
  assert.equal(copy.release_label, 'Tuesday');
});

test('evergreen topic pick is stable per week and covers the catalog', () => {
  assert.ok(EVERGREEN_TOPICS.length >= 8);
  const a = pickEvergreenTopic([], '2026-W41');
  const b = pickEvergreenTopic([], '2026-W41');
  assert.equal(a.slug, b.slug);
  const other = pickEvergreenTopic([a.slug], '2026-W41');
  assert.notEqual(other.slug, a.slug);
});

test('Buzz Board paraphrase strips emails/phones and Disney article filter works', () => {
  assert.match(paraphraseQuestion('Email me at test@example.com about waits'), /email removed/i);
  assert.equal(
    isDisneyArticle({ title: 'Magic Kingdom parade update', category: 'theme-parks', dek: '', slug: 'mk' }),
    true
  );
  assert.equal(
    isDisneyArticle({ title: 'Epic Universe opening tips', category: 'theme-parks', dek: 'Universal Orlando', slug: 'epic' }),
    false
  );
  assert.equal(
    isDisneyArticle({ title: 'Central Florida theme park parking tip', category: 'theme-parks', dek: '', slug: 'parking' }),
    false
  );
});

test('show notes include resources section with tracking params', () => {
  const html = buildShowNotesHtml({
    episodeTitle: 'Test episode',
    site: 'https://thefloridabuzz.com',
    episode: { slug: 'weekly-2026-w41-a1-tue', week_key: '2026-W41' },
    sources: [
      {
        source_kind: 'buzz_board',
        title: 'Is rope drop worth it?',
        url: 'https://thefloridabuzz.com/buzz/rope-drop',
        included: true,
      },
    ],
  });
  assert.match(html, /Florida Buzz Resources Mentioned/);
  assert.doesNotMatch(html, /AI-generated hosts/);
  assert.match(html, /not affiliated with/i);
  assert.match(html, /Buzz Board/);
  assert.match(html, /utm_source=florida_buzz_podcast/);
  assert.match(html, /utm_campaign=florida_buzz_disney/);
  assert.match(html, /utm_content=weekly-2026-w41-a1-tue/);
  assert.match(html, /\/wait-times/);
  assert.match(html, /\/planner/);
  assert.match(html, /\/dining/);
});

test('weekly draft stays disabled by default and never auto-publishes', async () => {
  const store = createMemoryStore();
  const settings = await store.getScheduleSettings();
  assert.equal(settings.weekly_draft_enabled, false);
  assert.equal(defaultSettings().auto_publish_enabled, false);
  assert.equal(defaultSettings().intended_publish_weekday, 2);
  assert.equal(defaultSettings().intended_publish_weekday_b, 5);
  assert.equal(config({}).generation, false);

  const skipped = await createWeeklyDraft({
    store,
    supabase: null,
    cfg: config({}),
    aiText: null,
    pipeline: null,
    sendEmail: null,
    force: false,
    now: new Date('2026-10-08T23:05:00.000Z'),
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'weekly_draft_disabled');

  await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });
  const result = await createWeeklyDraft({
    store,
    supabase: {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          gte() { return this; },
          order() { return this; },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
      },
      rpc() {
        return Promise.resolve({ data: [], error: null });
      },
    },
    cfg: config({ PODCASTS_GENERATION_ENABLED: 'false' }),
    aiText: null,
    pipeline: {
      async generatePreview() {
        throw new Error('audio must not run when generation disabled');
      },
    },
    sendEmail: async () => {
      throw new Error('email should not be required for this assertion');
    },
    force: true,
    now: new Date('2026-10-08T23:05:00.000Z'),
  });
  assert.equal(result.skipped, false);
  assert.ok(result.episode);
  assert.ok(Array.isArray(result.episodes));
  assert.equal(result.episodes.length, 2);
  assert.equal(result.episodesPerWeek, 2);
  assert.notEqual(result.episode.status, 'published');
  assert.notEqual(result.episode.status, 'scheduled');
  assert.equal(result.audioGenerated, false);

  const [tue, fri] = result.episodes;
  assert.equal(tue.intended_publish_weekday, 2);
  assert.equal(fri.intended_publish_weekday, 5);
  assert.match(tue.slug, /-tue$/);
  assert.match(fri.slug, /-fri$/);
  assert.doesNotMatch(tue.title, /Part\s*\d/i);
  assert.doesNotMatch(fri.title, /Part\s*\d/i);
  assert.doesNotMatch(tue.slug, /-p\d/);
  assert.notEqual(tue.title, fri.title);
  assert.ok(result.releaseSlots);
  assert.equal(result.releaseSlots[0].label, 'Tuesday');
  assert.equal(result.releaseSlots[1].label, 'Friday');

  const sources = await store.listSources(result.episode.id);
  assert.ok(sources.some((s) => s.source_kind === 'evergreen_topic'));
});

test('splitSourcesForEpisodes spreads articles across standalone episodes', () => {
  const sources = [
    { source_kind: 'article', title: 'A1' },
    { source_kind: 'article', title: 'A2' },
    { source_kind: 'article', title: 'A3' },
    { source_kind: 'buzz_board', title: 'B1' },
    { source_kind: 'evergreen_topic', title: 'E1' },
  ];
  const buckets = splitSourcesForEpisodes(sources, 2);
  assert.equal(buckets.length, 2);
  assert.ok(buckets[0].length >= 1);
  assert.ok(buckets[1].length >= 1);
  assert.ok(buckets[0].some((s) => s.source_kind === 'evergreen_topic'));
  assert.ok(buckets[1].some((s) => s.source_kind === 'evergreen_topic'));
});
