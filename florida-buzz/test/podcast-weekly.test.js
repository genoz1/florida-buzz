'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  weekKeyEt,
  matchesGenerateSlot,
  matchingGenerateSlot,
  partsInTimezone,
  describeSchedule,
  generateSlotsFromSettings,
} = require('../lib/podcasts/timeEt');
const { pickEvergreenTopic, EVERGREEN_TOPICS } = require('../lib/podcasts/evergreenTopics');
const { paraphraseQuestion, isDisneyArticle } = require('../lib/podcasts/sourceCollector');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const {
  createWeeklyDraft,
  buildShowNotesHtml,
  buildEpisodeCopy,
  defaultSettings,
  releaseSlotsFromSettings,
  selectReleaseSlotForRun,
  stripPartLabels,
  splitSourcesForEpisodes,
} = require('../lib/podcasts/weeklyDraft');
const { config } = require('../lib/podcasts/config');

function mockSupabase() {
  return {
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
  };
}

test('Eastern week key and Tuesday/Friday generate slot matching', () => {
  // Tuesday 7:05 AM EDT = 2026-10-06T11:05:00.000Z
  const tuesday7 = new Date('2026-10-06T11:05:00.000Z');
  const parts = partsInTimezone(tuesday7);
  assert.equal(parts.weekday, 2);
  assert.equal(parts.hour, 7);
  assert.ok(weekKeyEt(tuesday7).startsWith('2026-W'));

  const settings = defaultSettings();
  assert.equal(matchesGenerateSlot(settings, tuesday7), true);
  assert.equal(matchingGenerateSlot(settings, tuesday7)?.weekday, 2);

  // Friday 7:05 AM EDT
  const friday7 = new Date('2026-10-09T11:05:00.000Z');
  assert.equal(partsInTimezone(friday7).weekday, 5);
  assert.equal(matchesGenerateSlot(settings, friday7), true);
  assert.equal(matchingGenerateSlot(settings, friday7)?.weekday, 5);

  // Thursday evening (old single-run slot) must NOT match new defaults
  const thursday7pm = new Date('2026-10-08T23:05:00.000Z');
  assert.equal(matchesGenerateSlot(settings, thursday7pm), false);

  assert.equal(
    matchesGenerateSlot(settings, new Date('2026-10-06T12:00:00.000Z')),
    false
  );
});

test('generateSlotsFromSettings falls back when generate_*_b missing', () => {
  const slots = generateSlotsFromSettings({
    generate_weekday: 2,
    generate_hour: 7,
    generate_minute: 0,
    intended_publish_weekday_b: 5,
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].weekday, 2);
  assert.equal(slots[1].weekday, 5);
  assert.equal(slots[1].hour, 7);
});

test('schedule labels describe Tuesday and Friday generate + release', () => {
  const labels = describeSchedule(defaultSettings());
  assert.match(labels.generateLabel, /Tuesday/i);
  assert.match(labels.generateLabel, /Friday/i);
  assert.match(labels.generateLabel, /one episode per run/i);
  assert.match(labels.publishLabel, /Tuesday/i);
  assert.match(labels.publishLabel, /Friday/i);
  assert.match(labels.publishSlotALabel, /Tuesday/i);
  assert.match(labels.publishSlotBLabel, /Friday/i);
  assert.doesNotMatch(labels.publishLabel, /Part\s*1/i);
});

test('release slots default to Tuesday then Friday', () => {
  const slots = releaseSlotsFromSettings(defaultSettings());
  assert.equal(slots.length, 2);
  assert.equal(slots[0].weekday, 2);
  assert.equal(slots[0].label, 'Tuesday');
  assert.equal(slots[0].key, 'tue');
  assert.equal(slots[1].weekday, 5);
  assert.equal(slots[1].label, 'Friday');
  assert.equal(slots[1].key, 'fri');
});

test('selectReleaseSlotForRun picks today on Tue/Fri force, else next upcoming', () => {
  const settings = defaultSettings();

  const tue = selectReleaseSlotForRun({
    settings,
    now: new Date('2026-10-06T15:00:00.000Z'), // Tue afternoon ET
    force: true,
  });
  assert.equal(tue.slot.key, 'tue');
  assert.equal(tue.reason, 'force_today');

  const fri = selectReleaseSlotForRun({
    settings,
    now: new Date('2026-10-09T15:00:00.000Z'), // Fri afternoon ET
    force: true,
  });
  assert.equal(fri.slot.key, 'fri');
  assert.equal(fri.reason, 'force_today');

  // Saturday → next Tuesday
  const sat = selectReleaseSlotForRun({
    settings,
    now: new Date('2026-10-10T22:00:00.000Z'),
    force: true,
  });
  assert.equal(sat.slot.key, 'tue');
  assert.equal(sat.reason, 'force_next');

  // Cron path: Tuesday generate window
  const cronTue = selectReleaseSlotForRun({
    settings,
    now: new Date('2026-10-06T11:05:00.000Z'),
    force: false,
  });
  assert.equal(cronTue.slot.key, 'tue');
  assert.equal(cronTue.reason, 'generate_slot');
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
  assert.equal(defaultSettings().generate_weekday, 2);
  assert.equal(defaultSettings().generate_weekday_b, 5);
  assert.equal(config({}).generation, false);

  const skipped = await createWeeklyDraft({
    store,
    supabase: null,
    cfg: config({}),
    aiText: null,
    pipeline: null,
    sendEmail: null,
    force: false,
    now: new Date('2026-10-06T11:05:00.000Z'),
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'weekly_draft_disabled');
});

test('force weekly draft creates exactly one episode for the selected slot', async () => {
  const store = createMemoryStore();
  await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });

  // Saturday force → next Tuesday slot, one episode only
  const result = await createWeeklyDraft({
    store,
    supabase: mockSupabase(),
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
    now: new Date('2026-10-10T22:00:00.000Z'),
  });
  assert.equal(result.skipped, false);
  assert.ok(result.episode);
  assert.ok(Array.isArray(result.episodes));
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodesCreated, 1);
  assert.equal(result.episodesPerWeek, 1);
  assert.equal(result.releaseSlot.key, 'tue');
  assert.equal(result.slotReason, 'force_next');
  assert.notEqual(result.episode.status, 'published');
  assert.notEqual(result.episode.status, 'scheduled');
  assert.equal(result.audioGenerated, false);
  assert.equal(result.episode.intended_publish_weekday, 2);
  assert.match(result.episode.slug, /-tue$/);
  assert.doesNotMatch(result.episode.title, /Part\s*\d/i);
  assert.doesNotMatch(result.episode.slug, /-p\d/);

  const all = await store.listEpisodes((await store.getShow('florida-buzz-disney')).id);
  assert.equal(all.length, 1);

  const sources = await store.listSources(result.episode.id);
  assert.ok(sources.some((s) => s.source_kind === 'evergreen_topic'));
});

test('Tuesday force creates Tuesday episode; Friday force creates Friday episode', async () => {
  const store = createMemoryStore();
  await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });
  const deps = {
    store,
    supabase: mockSupabase(),
    cfg: config({ PODCASTS_GENERATION_ENABLED: 'false' }),
    aiText: null,
    pipeline: null,
    sendEmail: null,
    force: true,
  };

  const tue = await createWeeklyDraft({
    ...deps,
    now: new Date('2026-10-06T15:00:00.000Z'),
  });
  assert.equal(tue.episodes.length, 1);
  assert.equal(tue.releaseSlot.key, 'tue');
  assert.match(tue.episode.slug, /-tue$/);

  const fri = await createWeeklyDraft({
    ...deps,
    now: new Date('2026-10-09T15:00:00.000Z'),
  });
  assert.equal(fri.episodes.length, 1);
  assert.equal(fri.releaseSlot.key, 'fri');
  assert.match(fri.episode.slug, /-fri$/);
  assert.notEqual(tue.episode.id, fri.episode.id);

  const show = await store.getShow('florida-buzz-disney');
  const all = await store.listEpisodes(show.id);
  assert.equal(all.length, 2);
});

test('cron path on Tuesday generate window creates one Tuesday episode only', async () => {
  const store = createMemoryStore();
  await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });

  const result = await createWeeklyDraft({
    store,
    supabase: mockSupabase(),
    cfg: config({}),
    aiText: null,
    pipeline: null,
    sendEmail: null,
    force: false,
    now: new Date('2026-10-06T11:05:00.000Z'),
  });
  assert.equal(result.skipped, false);
  assert.equal(result.episodes.length, 1);
  assert.equal(result.releaseSlot.key, 'tue');
  assert.equal(result.slotReason, 'generate_slot');
});

test('autoPreview config is on only when generation enabled and not explicitly disabled', () => {
  assert.equal(config({ PODCASTS_GENERATION_ENABLED: 'true' }).autoPreview, true);
  assert.equal(
    config({ PODCASTS_GENERATION_ENABLED: 'true', PODCASTS_AUTO_PREVIEW_ENABLED: 'false' }).autoPreview,
    false
  );
  assert.equal(
    config({ PODCASTS_GENERATION_ENABLED: 'true', PODCASTS_AUTO_PREVIEW_ENABLED: '0' }).autoPreview,
    false
  );
  assert.equal(config({ PODCASTS_GENERATION_ENABLED: 'false' }).autoPreview, false);
});

test('scaffold weekly draft never auto-starts private preview even when generation is on', async () => {
  const store = createMemoryStore();
  await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });

  let previewCalls = 0;
  const result = await createWeeklyDraft({
    store,
    supabase: mockSupabase(),
    cfg: config({
      PODCASTS_GENERATION_ENABLED: 'true',
      ELEVENLABS_API_KEY: 'test-key',
    }),
    aiText: null, // forces short scaffold — must not burn ElevenLabs credits
    pipeline: {
      async generatePreview() {
        previewCalls += 1;
        return { ok: true };
      },
    },
    sendEmail: null,
    force: true,
    now: new Date('2026-10-06T15:00:00.000Z'),
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(result.skipped, false);
  assert.equal(previewCalls, 0);
  assert.equal(result.audioGenerated, false);
  assert.notEqual(result.episode.status, 'published');
  const runs = await store.listGenerationRuns('florida-buzz-disney', result.weekKey);
  const ready = runs.find((r) => r.status === 'draft_ready');
  assert.ok(ready);
  assert.equal(ready.payload?.audio_auto_preview_started, false);
  assert.equal(ready.payload?.used_fallback_script, true);
});

test('full AI script weekly draft auto-starts private preview and never publishes', async () => {
  const scriptPath = require.resolve('../lib/podcasts/script');
  const weeklyPath = require.resolve('../lib/podcasts/weeklyDraft');
  const realScript = require('../lib/podcasts/script');
  const longScript = [
    'Geno: [excited] Welcome to Florida Buzz: Disney. I\'m Geno — your unofficial fan host. Let\'s go.',
    `Geno: ${'Quick hit on park planning and dining tips for guests. '.repeat(30)}`,
  ].join('\n\n');
  assert.ok(longScript.length > 200);

  require.cache[scriptPath].exports = {
    ...realScript,
    async generateOutline() {
      return 'Outline: quick hits and one deep dive.';
    },
    async generateConversation() {
      return longScript;
    },
  };
  delete require.cache[weeklyPath];
  const { createWeeklyDraft: createDraftWithMockScript } = require('../lib/podcasts/weeklyDraft');

  try {
    const store = createMemoryStore();
    await store.upsertScheduleSettings('florida-buzz-disney', { weekly_draft_enabled: true });

    let previewCalls = 0;
    let previewEpisodeId = null;
    const result = await createDraftWithMockScript({
      store,
      supabase: mockSupabase(),
      cfg: config({
        PODCASTS_GENERATION_ENABLED: 'true',
        ELEVENLABS_API_KEY: 'test-key',
      }),
      aiText: {
        async generateText() {
          return 'TITLE: Tuesday Magic Hours\nDESCRIPTION: Geno covers wait times for a solo Tuesday show.';
        },
      },
      pipeline: {
        async generatePreview(episode) {
          previewCalls += 1;
          previewEpisodeId = episode.id;
          return { ok: true };
        },
      },
      sendEmail: null,
      force: true,
      now: new Date('2026-10-06T15:00:00.000Z'),
    });

    // Background setImmediate from weeklyDraft
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    assert.equal(result.skipped, false);
    assert.equal(previewCalls, 1);
    assert.equal(previewEpisodeId, result.episode.id);
    assert.equal(result.audioGenerated, false); // still async at return time
    assert.notEqual(result.episode.status, 'published');
    assert.notEqual(result.episode.status, 'scheduled');
    assert.notEqual(result.episode.status, 'approved');

    const runs = await store.listGenerationRuns('florida-buzz-disney', result.weekKey);
    const ready = runs.find((r) => r.status === 'draft_ready');
    assert.equal(ready?.payload?.audio_auto_preview_started, true);
    assert.equal(ready?.payload?.used_fallback_script, false);
  } finally {
    require.cache[scriptPath].exports = realScript;
    delete require.cache[weeklyPath];
    require('../lib/podcasts/weeklyDraft');
  }
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
