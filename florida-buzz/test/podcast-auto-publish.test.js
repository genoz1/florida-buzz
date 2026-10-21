'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { config } = require('../lib/podcasts/config');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const {
  approveAndPublishEpisode,
  isScaffoldEpisode,
} = require('../lib/podcasts/autoPublish');

test('autoPublish config requires generation and explicit env flag', () => {
  assert.equal(config({}).autoPublish, false);
  assert.equal(config({ PODCASTS_GENERATION_ENABLED: 'true' }).autoPublish, false);
  assert.equal(
    config({ PODCASTS_GENERATION_ENABLED: 'true', PODCASTS_AUTO_PUBLISH_ENABLED: 'true' }).autoPublish,
    true
  );
});

test('scaffold episodes are refused for auto-publish', () => {
  assert.equal(isScaffoldEpisode({ script_text: 'short', outline_json: { fallback: true } }), true);
  assert.equal(
    isScaffoldEpisode({
      script_text: 'x'.repeat(500),
      outline_json: { fallback: false },
      last_error: null,
    }),
    false
  );
});

test('approveAndPublishEpisode moves preview_ready to published and queues YouTube stills', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Auto publish test',
    description: 'Testing hands-off publish',
    show_notes_html: '<p>notes</p>',
    slug: 'auto-publish-test',
  });
  await store.updateEpisode(episode.id, {
    status: 'preview_ready',
    audio_url: 'https://example.com/audio.mp3',
    script_text: 'Geno: '.concat('This is a full enough script for auto publish. ').repeat(20),
    outline_json: { fallback: false },
  });

  let stillsCalls = 0;
  let videoCalls = 0;
  const videoPipeline = {
    publishEpisode: async () => {
      videoCalls += 1;
      return { id: 'yt-test', url: 'https://youtu.be/yt-test' };
    },
  };
  const stillsReview = {
    queueStillsPrepare: ({ episode: ep }) => {
      stillsCalls += 1;
      assert.equal(ep.status, 'published');
      return { queued: true };
    },
  };
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'true',
    PODCASTS_AUTO_PUBLISH_ENABLED: 'true',
    PODCASTS_YOUTUBE_ENABLED: 'true',
  });

  const result = await approveAndPublishEpisode({
    store,
    episode: await store.getEpisodeById(episode.id),
    cfg,
    videoPipeline,
    stillsReview,
    reason: 'test',
  });
  assert.equal(result.skipped, false);
  assert.equal(result.episode.status, 'published');
  assert.ok(result.episode.published_at);
  assert.equal(result.youtube.queued, true);
  assert.equal(stillsCalls, 1);
  assert.equal(videoCalls, 0);
});

test('approveAndPublishEpisode no-ops when autoPublish is off', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Manual publish still',
    description: 'Stay preview_ready',
    show_notes_html: '<p>notes</p>',
    slug: 'manual-publish-still',
  });
  await store.updateEpisode(episode.id, {
    status: 'preview_ready',
    audio_url: 'https://example.com/audio.mp3',
    script_text: 'Geno: '.concat('Full script text here. ').repeat(20),
  });
  const result = await approveAndPublishEpisode({
    store,
    episode: await store.getEpisodeById(episode.id),
    cfg: config({ PODCASTS_GENERATION_ENABLED: 'true' }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'auto_publish_disabled');
  assert.equal((await store.getEpisodeById(episode.id)).status, 'preview_ready');
});
