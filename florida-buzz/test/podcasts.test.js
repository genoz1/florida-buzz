'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const path = require('node:path');

const { config, DEFAULT_FAL_TTS_ENDPOINT, DEFAULT_FAL_TTS_MODEL } = require('../lib/podcasts/config');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const { buildRss } = require('../lib/podcasts/rss');
const { assertTransition, validateEpisodeFields, slugify } = require('../lib/podcasts/validation');
const { sanitizeShowNotesHtml } = require('../lib/podcasts/sanitize');
const {
  splitScriptIntoSections,
  formatScriptForTts,
  buildOutlinePrompt,
  buildConversationPrompt,
  countScriptWords,
  appendContinuation,
  generateConversation,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_MIN_WORDS,
} = require('../lib/podcasts/script');
const {
  HOST_BIBLE,
  HOST_STYLE,
  ensureShowNotesDisclosures,
} = require('../lib/podcasts/hosts');
const { createPublicRouter } = require('../lib/podcasts/routerPublic');
const { createAdminRouter } = require('../lib/podcasts/routerAdmin');
const { createFalTts } = require('../lib/podcasts/falTts');
const { createAudioPipeline } = require('../lib/podcasts/audioPipeline');

test('podcast public routes default on; generation stays off', () => {
  const cfg = config({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.generation, false);
  assert.equal(config({ PODCASTS_ENABLED: 'false' }).enabled, false);
  assert.equal(config({ PODCASTS_ENABLED: 'true' }).enabled, true);
  assert.equal(cfg.falEndpoint, DEFAULT_FAL_TTS_ENDPOINT);
  assert.equal(cfg.falModel, DEFAULT_FAL_TTS_MODEL);
  assert.equal(cfg.genaVoice, 'Aoede');
  assert.equal(cfg.dianeVoice, 'Zephyr');
  assert.equal(cfg.falConfigVerifiedInRepo, false);
});

test('describeAudioProgress distinguishes LIVE heartbeats from DEAD running jobs', () => {
  const { describeAudioProgress } = require('../lib/podcasts/audioStatus');
  const now = Date.parse('2026-10-10T21:30:00.000Z');
  const live = describeAudioProgress({
    episode: { status: 'generating_audio', audio_url: null },
    jobs: [
      {
        status: 'running',
        section_index: 4,
        section_count: 9,
        updated_at: '2026-10-10T21:29:40.000Z',
      },
    ],
    now,
  });
  assert.equal(live.state, 'live');
  assert.match(live.sectionLabel, /5\/9/);

  const dead = describeAudioProgress({
    episode: { status: 'generating_audio', audio_url: null },
    jobs: [
      {
        status: 'running',
        section_index: 4,
        section_count: 9,
        updated_at: '2026-10-10T21:20:00.000Z',
      },
    ],
    now,
  });
  assert.equal(dead.state, 'stalled');
  assert.match(dead.label, /DEAD/i);
});

test('prependAudioBuffer puts intro bytes ahead of body audio', async () => {
  const { prependAudioBuffer } = require('../lib/podcasts/audioPipeline');
  const ffmpegPath = (() => {
    try {
      return require('ffmpeg-static');
    } catch {
      return 'ffmpeg';
    }
  })();
  // Minimal valid-ish MP3 frames are hard; skip if ffmpeg cannot encode silence helpers.
  const { spawnSync } = require('node:child_process');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-intro-test-'));
  try {
    const intro = path.join(dir, 'intro.mp3');
    const body = path.join(dir, 'body.mp3');
    const mk = (file, seconds) =>
      spawnSync(
        ffmpegPath,
        ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-codec:a', 'libmp3lame', '-q:a', '9', file],
        { encoding: 'utf8' }
      );
    const a = mk(intro, 0.2);
    const b = mk(body, 0.3);
    if (a.status !== 0 || b.status !== 0) {
      console.log('# skip prepend test — ffmpeg lavfi unavailable');
      return;
    }
    const out = await prependAudioBuffer(await fsp.readFile(intro), await fsp.readFile(body), ffmpegPath);
    assert.ok(out.length > 1000);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test('stuck generating_audio can return to script_ready for TTS retry', () => {
  const { assertTransition } = require('../lib/podcasts/validation');
  assert.equal(assertTransition('generating_audio', 'script_ready'), 'script_ready');
});

test('recoverStuckPodcastWork clears stale running runs and generating_audio episodes', async () => {
  const { recoverStuckPodcastWork } = require('../lib/podcasts/recoverStuck');
  const { createMemoryStore } = require('../lib/podcasts/memoryStore');
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const run = await store.createGenerationRun({
    show_slug: 'florida-buzz-disney',
    week_key: '2026-W99',
    status: 'running',
    attempt: 1,
    payload: {},
  });
  // Memory store refreshs updated_at on patch — mutate timestamps directly for the stale check.
  run.created_at = old;
  run.updated_at = old;
  const episode = await store.createEpisode(show.id, {
    title: 'Stuck audio',
    description: 'Test',
    slug: 'stuck-audio',
    show_notes_html: '',
  });
  await store.updateEpisode(episode.id, {
    status: 'generating_audio',
    generation_run_id: run.id,
    script_text: 'Gena: Hello there friends.\n\nDiane: Hi back at you.',
  });
  episode.updated_at = old;

  const recovered = await recoverStuckPodcastWork(store, {
    showSlug: 'florida-buzz-disney',
    now: new Date(),
    staleMs: 15 * 60 * 1000,
  });
  assert.ok(recovered.runs >= 1);
  assert.ok(recovered.episodes >= 1);
  const freshEp = await store.getEpisodeById(episode.id);
  assert.equal(freshEp.status, 'script_ready');
});

test('status transitions block illegal publish paths', () => {
  assert.equal(assertTransition('draft', 'script_ready'), 'script_ready');
  assert.throws(() => assertTransition('draft', 'published'));
  assert.throws(() => assertTransition('generating_audio', 'published'));
  assert.equal(assertTransition('approved', 'published'), 'published');
});

test('show notes sanitizer strips scripts and unsafe urls', () => {
  const dirty = '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>';
  const clean = sanitizeShowNotesHtml(dirty);
  assert.match(clean, /<p>Hello<\/p>/);
  assert.doesNotMatch(clean, /script/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.match(clean, /https:\/\/example\.com/);
});

test('show notes always receive unofficial affiliation disclosure', () => {
  const withAffiliation = ensureShowNotesDisclosures('<p>Episode notes</p>');
  assert.match(withAffiliation, /not affiliated with/i);
  assert.doesNotMatch(withAffiliation, /AI-generated hosts/i);
  assert.equal(ensureShowNotesDisclosures(withAffiliation), withAffiliation);
});

test('full-episode prompts keep host bible and anecdote rules', () => {
  assert.equal(HOST_STYLE, 'aftershow_energy');
  assert.match(HOST_BIBLE, /Geno/);
  assert.match(HOST_BIBLE, /Michael/);
  assert.match(HOST_BIBLE, /mid-thirties/i);
  assert.match(HOST_BIBLE, /aftershow|reaction/i);
  const show = { title: 'Florida Buzz: Disney' };
  const episode = { title: 'Week in the parks', description: 'News and tips' };
  const sources = [
    {
      included: true,
      title: 'New dessert',
      url: 'https://example.com/dessert',
      summary: 'A new dessert arrives at a park restaurant.',
    },
  ];
  const outline = buildOutlinePrompt({ show, episode, sources });
  assert.match(outline.system, /2–3 brief/);
  assert.match(outline.system, /Never invent breaking-news/);
  assert.match(outline.system, /Geno/);
  assert.match(outline.system, /not a news rundown|friends exchanging stories/i);
  const conversation = buildConversationPrompt({
    show,
    episode,
    outline: '1. Open\n2. Dessert talk\nAnecdote: mobile order mixup',
    sources,
  });
  assert.match(conversation.system, /not presenters summarizing articles/i);
  assert.match(conversation.system, /callback/i);
  assert.match(conversation.system, /timeless composite/i);
  assert.doesNotMatch(conversation.user, /AI-generated hosts/i);
  assert.match(conversation.user, /not affiliated with/i);
  assert.match(conversation.system, /taking turns reading article summaries/i);
  assert.match(conversation.system, /The Florida Buzz dot com/i);
  assert.match(conversation.system, /3–5 natural Florida Buzz references/);
  assert.match(conversation.system, /never read long URLs/i);
  assert.match(outline.system, /Resource:/);
  assert.match(conversation.user, /\/wait-times/);
  assert.match(conversation.user, /\/planner/);
  assert.match(conversation.user, /\/dining/);
});

test('conversation token budget supports a ~30 minute script', () => {
  assert.ok(CONVERSATION_MAX_OUTPUT_TOKENS >= 20000);
  assert.ok(CONVERSATION_MIN_WORDS >= 3500);
  const conversation = buildConversationPrompt({
    show: { title: 'Florida Buzz: Disney' },
    episode: { title: 'Test', description: 'Desc' },
    outline: '1. Open',
    sources: [],
  });
  assert.match(conversation.system, /4,000–5,000 spoken words/i);
  assert.match(conversation.user, /Length requirement/i);
});

test('short AI scripts are rejected and continuations can append', async () => {
  assert.equal(countScriptWords('Gena: Hello there.\n\nDiane: Hi back.'), 4);
  const merged = appendContinuation(
    'Gena: We start here.\n\nDiane: Yes.',
    'Gena: And then we keep going about Magic Kingdom crowds.'
  );
  assert.match(merged, /We start here/);
  assert.match(merged, /Magic Kingdom crowds/);

  let calls = 0;
  const aiText = {
    async generateText(system, user, maxTokens) {
      calls += 1;
      assert.ok(maxTokens >= 20000);
      if (calls === 1) {
        return 'Gena: Short open.\n\nDiane: Short reply only.';
      }
      // Still short on purpose so generateConversation throws after continue attempts.
      return 'Gena: A little more.\n\nDiane: Still not enough words overall.';
    },
  };
  await assert.rejects(
    () =>
      generateConversation({
        aiText,
        show: { title: 'Florida Buzz: Disney' },
        episode: { title: 'Test', description: 'Test' },
        outline: '1. Open',
        sources: [],
      }),
    /too short for a ~30 minute episode/i
  );
  assert.ok(calls >= 2);
});

test('continuation recovers a full-length script after a short first pass', async () => {
  const pad = (label, n) => {
    const words = [];
    for (let i = 0; i < n; i += 1) words.push(`word${i}`);
    return `${label}: ${words.join(' ')}`;
  };
  let calls = 0;
  const aiText = {
    async generateText(_system, _user, maxTokens) {
      calls += 1;
      assert.ok(maxTokens >= 20000);
      if (calls === 1) {
        return `${pad('Gena', 40)}\n\n${pad('Diane', 40)}`;
      }
      // Second pass supplies enough spoken words to clear the 30-minute floor.
      return `${pad('Gena', 2200)}\n\n${pad('Diane', 2200)}`;
    },
  };
  const script = await generateConversation({
    aiText,
    show: { title: 'Florida Buzz: Disney' },
    episode: { title: 'Test', description: 'Test' },
    outline: '1. Open',
    sources: [],
  });
  assert.ok(countScriptWords(script) >= CONVERSATION_MIN_WORDS);
  assert.equal(calls, 2);
});

test('script sections split for long episodes and keep dialogue prefixes', () => {
  const lines = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`Gena: Point number ${i} with enough text to force multiple sections eventually.`);
    lines.push(`Diane: Short reaction ${i}.`);
  }
  const sections = splitScriptIntoSections(lines.join('\n'), 400);
  assert.ok(sections.length > 1);
  assert.match(formatScriptForTts(sections[0]), /^Gena:/m);
});

test('RSS omits draft audio and includes published enclosure fields', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const draft = await store.createEpisode(show.id, {
    title: 'Draft Only',
    description: 'Should not appear',
    slug: 'draft-only',
    show_notes_html: '',
    episode_number: 1,
  });
  await store.updateEpisode(draft.id, {
    audio_url: 'https://example.com/secret.mp3',
    audio_byte_size: 1234,
  });

  const published = await store.createEpisode(show.id, {
    title: 'Published One',
    description: 'Public episode',
    slug: 'published-one',
    show_notes_html: '<p>Notes</p>',
    episode_number: 2,
  });
  await store.updateEpisode(published.id, {
    audio_url: 'https://cdn.example.com/ep2.mp3',
    audio_byte_size: 9999,
    audio_content_type: 'audio/mpeg',
    duration_seconds: 125,
    status: 'approved',
  });
  await store.setStatus(published.id, 'published');

  const xml = buildRss({
    site: 'https://thefloridabuzz.com',
    show,
    ownerEmail: 'floridabuzzonline@gmail.com',
    episodes: await store.listEpisodes(show.id),
  });
  assert.match(xml, /<title>Florida Buzz: Disney<\/title>/);
  assert.match(xml, /Published One/);
  assert.match(xml, /cdn\.example\.com\/ep2\.mp3/);
  assert.match(xml, /length="9999"/);
  assert.match(xml, /type="audio\/mpeg"/);
  assert.match(xml, /itunes:duration>2:05/);
  assert.doesNotMatch(xml, /Draft Only/);
  assert.doesNotMatch(xml, /secret\.mp3/);
  assert.match(xml, /unofficial fan podcast/i);
  assert.doesNotMatch(xml, /AI-generated hosts/i);
  assert.match(xml, /floridabuzzonline@gmail\.com/);
});

test('episode ordering is newest published first', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const older = await store.createEpisode(show.id, {
    title: 'Older',
    description: 'older',
    slug: 'older',
    show_notes_html: '',
    episode_number: 1,
  });
  const newer = await store.createEpisode(show.id, {
    title: 'Newer',
    description: 'newer',
    slug: 'newer',
    show_notes_html: '',
    episode_number: 2,
  });
  await store.updateEpisode(older.id, {
    status: 'approved',
    audio_url: 'https://cdn.example.com/old.mp3',
    audio_byte_size: 10,
  });
  await store.setStatus(older.id, 'published');
  await store.updateEpisode(older.id, { published_at: '2026-01-01T12:00:00.000Z' });
  await store.updateEpisode(newer.id, {
    status: 'approved',
    audio_url: 'https://cdn.example.com/new.mp3',
    audio_byte_size: 10,
  });
  await store.setStatus(newer.id, 'published');
  await store.updateEpisode(newer.id, { published_at: '2026-02-01T12:00:00.000Z' });
  const list = await store.listPublishedEpisodes(show.id);
  assert.equal(list[0].slug, 'newer');
  assert.equal(list[1].slug, 'older');
});

test('fal TTS submit refuses when generation disabled', async () => {
  const cfg = config({ PODCASTS_GENERATION_ENABLED: 'false', FAL_KEY: 'test-key' });
  const fal = createFalTts(cfg, async () => {
    throw new Error('network should not be called');
  });
  await assert.rejects(() => fal.submit('Gena: hi\nDiane: hello'), /disabled/i);
});

test('fal TTS keeps Gena spelling with Gina pronunciation guidance', () => {
  const cfg = config({ PODCASTS_GENERATION_ENABLED: 'true', FAL_KEY: 'test-key' });
  const fal = createFalTts(cfg);
  const input = fal.buildInput('Gena: Hello\nDiane: Hi');
  assert.equal(input.speakers[0].speaker_id, 'Gena');
  assert.match(input.style_instructions, /pronounced like Gina/i);
  assert.match(input.style_instructions, /JEEN-uh/);
});

test('audio pipeline refuses paid generation when flag off', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'No paid call',
    description: 'desc',
    slug: 'no-paid',
    show_notes_html: '',
    episode_number: 3,
  });
  await store.setStatus(episode.id, 'script_ready');
  const cfg = config({ PODCASTS_GENERATION_ENABLED: 'false', FAL_KEY: 'x' });
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    ffmpegPath: 'ffmpeg',
  });
  await assert.rejects(
    () => pipeline.generatePreview(episode, 'Gena: Hello\nDiane: Hi there'),
    /PODCASTS_GENERATION_ENABLED/
  );
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('admin podcasts require HTTP Basic auth', async () => {
  const store = createMemoryStore();
  const cfg = config({ PODCASTS_ENABLED: 'true', ADMIN_PASSWORD: 'a-long-test-password' });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    '/admin/podcasts',
    createAdminRouter({
      store,
      cfg,
      pipeline: { generatePreview: async () => {}, attachUploadedAudio: async () => {} },
      aiText: null,
      env: { ADMIN_PASSWORD: 'a-long-test-password' },
    })
  );
  const { server, port } = await listen(app);
  try {
    const denied = await request(port, 'GET', '/admin/podcasts');
    assert.equal(denied.status, 401);
    assert.match(denied.headers['www-authenticate'] || '', /Basic/);
    const allowed = await request(port, 'GET', '/admin/podcasts', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:a-long-test-password').toString('base64') },
    });
    assert.equal(allowed.status, 200);
    assert.match(allowed.body, /Florida Buzz Podcast admin/);
  } finally {
    server.close();
  }
});

test('public player renders for published episodes and hides drafts', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const draft = await store.createEpisode(show.id, {
    title: 'Hidden Draft',
    description: 'hidden',
    slug: 'hidden-draft',
    show_notes_html: '',
    episode_number: 8,
  });
  await store.updateEpisode(draft.id, { audio_url: 'https://cdn.example.com/hidden.mp3' });

  const live = await store.createEpisode(show.id, {
    title: 'Live Episode',
    description: 'live desc',
    slug: 'live-episode',
    show_notes_html: '<p>Safe</p>',
    episode_number: 9,
  });
  await store.updateEpisode(live.id, {
    status: 'approved',
    audio_url: 'https://cdn.example.com/live.mp3',
    audio_byte_size: 2048,
    duration_seconds: 60,
  });
  await store.setStatus(live.id, 'published');

  const cfg = config({ PODCASTS_ENABLED: 'true', SITE_URL: 'https://thefloridabuzz.com' });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/podcasts', createPublicRouter({ store, cfg }));

  const { server, port } = await listen(app);
  try {
    const showPage = await request(port, 'GET', '/podcasts/florida-buzz-disney');
    assert.equal(showPage.status, 200);
    assert.match(showPage.body, /Live Episode/);
    assert.match(showPage.body, /<audio controls/);
    assert.match(showPage.body, /cdn\.example\.com\/live\.mp3/);
    assert.doesNotMatch(showPage.body, /Hidden Draft/);
    assert.match(showPage.body, /unofficial fan podcast/i);

    const draftPage = await request(port, 'GET', '/podcasts/florida-buzz-disney/hidden-draft');
    assert.equal(draftPage.status, 404);

    const epPage = await request(port, 'GET', '/podcasts/florida-buzz-disney/live-episode');
    assert.equal(epPage.status, 200);
    assert.match(epPage.body, /<audio controls/);
    assert.match(epPage.body, /og:title|Live Episode/i);

    const rss = await request(port, 'GET', '/podcasts/florida-buzz-disney/rss.xml');
    assert.equal(rss.status, 200);
    assert.match(rss.headers['content-type'] || '', /rss|xml/);
    assert.match(rss.body, /live\.mp3/);
    assert.doesNotMatch(rss.body, /hidden\.mp3/);
  } finally {
    server.close();
  }
});

test('manual publish workflow never auto-publishes from preview', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Needs approval',
    description: 'desc',
    slug: 'needs-approval',
    show_notes_html: '',
    episode_number: 4,
  });
  await store.setStatus(episode.id, 'script_ready');
  await store.updateEpisode(episode.id, {
    status: 'preview_ready',
    audio_url: 'https://cdn.example.com/preview.mp3',
    audio_byte_size: 100,
  });
  const published = await store.listPublishedEpisodes(show.id);
  assert.equal(published.length, 0);
  await store.setStatus(episode.id, 'approved');
  await store.setStatus(episode.id, 'published');
  const after = await store.listPublishedEpisodes(show.id);
  assert.equal(after.length, 1);
});

test('episode field validation and slugify', () => {
  const fields = validateEpisodeFields({ title: 'Park Tips!', description: 'Useful tips' });
  assert.equal(fields.slug, 'park-tips');
  assert.equal(slugify('Hello World!!'), 'hello-world');
});
