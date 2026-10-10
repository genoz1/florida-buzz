'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { weekKeyEt, matchesGenerateSlot, partsInTimezone } = require('../lib/podcasts/timeEt');
const { pickEvergreenTopic, EVERGREEN_TOPICS } = require('../lib/podcasts/evergreenTopics');
const { paraphraseQuestion, isDisneyArticle } = require('../lib/podcasts/sourceCollector');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const { createWeeklyDraft, buildShowNotesHtml, defaultSettings } = require('../lib/podcasts/weeklyDraft');
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
    episode: { slug: 'weekly-2026-w41-a1', week_key: '2026-W41' },
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
  assert.match(html, /AI-generated hosts/);
  assert.match(html, /Buzz Board/);
  assert.match(html, /utm_source=florida_buzz_podcast/);
  assert.match(html, /utm_campaign=florida_buzz_disney/);
  assert.match(html, /utm_content=weekly-2026-w41-a1/);
  assert.match(html, /\/wait-times/);
  assert.match(html, /\/planner/);
  assert.match(html, /\/dining/);
});

test('weekly draft stays disabled by default and never auto-publishes', async () => {
  const store = createMemoryStore();
  const settings = await store.getScheduleSettings();
  assert.equal(settings.weekly_draft_enabled, false);
  assert.equal(defaultSettings().auto_publish_enabled, false);
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
  assert.notEqual(result.episode.status, 'published');
  assert.notEqual(result.episode.status, 'scheduled');
  assert.equal(result.audioGenerated, false);
  const sources = await store.listSources(result.episode.id);
  assert.ok(sources.some((s) => s.source_kind === 'evergreen_topic'));
});
