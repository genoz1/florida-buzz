'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const path = require('node:path');

const {
  config,
  DEFAULT_FAL_TTS_ENDPOINT,
  DEFAULT_FAL_TTS_MODEL,
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_ELEVEN_VOICE_GENO,
} = require('../lib/podcasts/config');
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
  assertScriptOpenShape,
  appendContinuation,
  generateConversation,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_MIN_WORDS,
  GENO_NAMED_OPEN_OPTION_A,
} = require('../lib/podcasts/script');
const {
  HOST_BIBLE,
  HOST_STYLE,
  ensureShowNotesDisclosures,
} = require('../lib/podcasts/hosts');
const { createPublicRouter } = require('../lib/podcasts/routerPublic');
const { createAdminRouter } = require('../lib/podcasts/routerAdmin');
const { createFalTts } = require('../lib/podcasts/falTts');
const { createElevenTts } = require('../lib/podcasts/elevenTts');
const { createAudioPipeline } = require('../lib/podcasts/audioPipeline');

test('podcast public routes default on; generation stays off', () => {
  const cfg = config({});
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.generation, false);
  assert.equal(config({ PODCASTS_ENABLED: 'false' }).enabled, false);
  assert.equal(config({ PODCASTS_ENABLED: 'true' }).enabled, true);
  assert.equal(cfg.ttsProvider, 'elevenlabs');
  assert.equal(cfg.hostMode, 'solo');
  assert.equal(cfg.elevenModel, DEFAULT_ELEVEN_MODEL);
  assert.equal(cfg.elevenVoiceGeno, DEFAULT_ELEVEN_VOICE_GENO);
  assert.equal(cfg.falEndpoint, DEFAULT_FAL_TTS_ENDPOINT);
  assert.equal(cfg.falModel, DEFAULT_FAL_TTS_MODEL);
  assert.equal(cfg.falConfigVerifiedInRepo, false);
});

test('podcast TTS provider and Geno voice resolve from env', () => {
  assert.equal(config({ ELEVENLABS_API_KEY: 'sk_test' }).ttsProvider, 'elevenlabs');
  assert.equal(config({ PODCASTS_TTS_PROVIDER: 'fal', FAL_KEY: 'x' }).ttsProvider, 'fal');
  assert.equal(
    config({ PODCASTS_ELEVEN_VOICE_GENO: 'customVoice123' }).elevenVoiceGeno,
    'customVoice123'
  );
  assert.equal(
    config({ PODCASTS_ELEVEN_VOICE_ID: 'aliasVoice456' }).elevenVoiceGeno,
    'aliasVoice456'
  );
});

test('encodePodcastMaster recompresses audio under a smaller bitrate', async () => {
  const { encodePodcastMaster } = require('../lib/podcasts/audioPipeline');
  const ffmpegPath = (() => {
    try {
      return require('ffmpeg-static');
    } catch {
      return 'ffmpeg';
    }
  })();
  const { spawnSync } = require('node:child_process');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-encode-test-'));
  try {
    const src = path.join(dir, 'src.mp3');
    const mk = spawnSync(
      ffmpegPath,
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-codec:a', 'libmp3lame', '-b:a', '192k', src],
      { encoding: 'utf8' }
    );
    if (mk.status !== 0) return;
    const out = await encodePodcastMaster(await fsp.readFile(src), ffmpegPath);
    assert.ok(out.length > 500);
    assert.ok(out.length < (await fsp.stat(src)).size);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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

test('concatMp3Buffers trims section padding and uses varied inter-section gaps', async () => {
  const {
    concatMp3Buffers,
    interSectionGapMs,
    INTER_SECTION_GAP_MS,
  } = require('../lib/podcasts/audioPipeline');
  assert.ok(INTER_SECTION_GAP_MS.length >= 4);
  assert.notEqual(interSectionGapMs(0), interSectionGapMs(1));
  assert.notEqual(interSectionGapMs(1), interSectionGapMs(2));
  const ffmpegPath = (() => {
    try {
      return require('ffmpeg-static');
    } catch {
      return 'ffmpeg';
    }
  })();
  const { spawnSync } = require('node:child_process');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-concat-test-'));
  try {
    // Tone with leading+trailing silence — mimics fal section padding.
    const mkPadded = (file) =>
      spawnSync(
        ffmpegPath,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=660:duration=0.35',
          '-af',
          'adelay=250|250,apad=pad_dur=0.25',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '96k',
          '-ac',
          '1',
          '-ar',
          '44100',
          file,
        ],
        { encoding: 'utf8' }
      );
    const aPath = path.join(dir, 'a.mp3');
    const bPath = path.join(dir, 'b.mp3');
    const cPath = path.join(dir, 'c.mp3');
    if (mkPadded(aPath).status !== 0 || mkPadded(bPath).status !== 0 || mkPadded(cPath).status !== 0) {
      console.log('# skip concat gap test — ffmpeg lavfi unavailable');
      return;
    }
    const out = await concatMp3Buffers(
      [await fsp.readFile(aPath), await fsp.readFile(bPath), await fsp.readFile(cPath)],
      ffmpegPath
    );
    assert.ok(out.length > 1500);
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

test('show notes always receive affiliation disclosure', () => {
  const withAffiliation = ensureShowNotesDisclosures('<p>Episode notes</p>');
  assert.match(withAffiliation, /not affiliated with/i);
  assert.doesNotMatch(withAffiliation, /unofficial/i);
  assert.doesNotMatch(withAffiliation, /AI-generated hosts/i);
  assert.match(withAffiliation, /Undercover Tourist/i);
  assert.match(withAffiliation, /thefloridabuzz\.com\/go\/undercover/);
  assert.equal(ensureShowNotesDisclosures(withAffiliation), withAffiliation);
});

test('assertScriptOpenShape requires Geno Option A named open', () => {
  const good = [
    `Geno: ${GENO_NAMED_OPEN_OPTION_A}`,
    'Geno: [conversational] Quick hits first, then one deeper dive.',
  ].join('\n');
  assert.doesNotThrow(() => assertScriptOpenShape(good));
  assert.match(GENO_NAMED_OPEN_OPTION_A, /\[conversational\]/i);
  assert.match(GENO_NAMED_OPEN_OPTION_A, /\[warmly\]/i);
  assert.match(GENO_NAMED_OPEN_OPTION_A, /Florida Buzz Disney podcast/i);
  assert.match(GENO_NAMED_OPEN_OPTION_A, /your host Geno/i);
  assert.match(GENO_NAMED_OPEN_OPTION_A, /thank you for joining us/i);
  assert.doesNotMatch(GENO_NAMED_OPEN_OPTION_A, /eighteen months/i);
  assert.doesNotMatch(GENO_NAMED_OPEN_OPTION_A, /fifty years/i);
  assert.doesNotMatch(GENO_NAMED_OPEN_OPTION_A, /unofficial/i);

  const weatherColdOpen = [
    'Geno: Okay, how was your week? Rain everywhere and sandals were a mistake.',
    'Geno: Welcome to Florida Buzz: Disney.',
  ].join('\n');
  assert.throws(() => assertScriptOpenShape(weatherColdOpen), /Okay, how was your week/i);

  const dualHost = [
    "Gena: Hi, I'm Gena.",
    "Diane: And I'm Diane.",
    'Gena: Welcome to Florida Buzz: Disney.',
  ].join('\n');
  assert.throws(() => assertScriptOpenShape(dualHost), /dual-host|Geno:/i);

  const missingLetsGo = [
    "Geno: Welcome to the Florida Buzz Disney podcast. I'm your host Geno, and thank you for joining us.",
  ].join('\n');
  assert.throws(() => assertScriptOpenShape(missingLetsGo), /Let's go/i);

  const saysUnofficial = [
    "Geno: Welcome to the Florida Buzz Disney podcast. I'm your host Geno — your unofficial fan host. Thank you for joining us. Let's go.",
  ].join('\n');
  assert.throws(() => assertScriptOpenShape(saysUnofficial), /unofficial/i);

  const longevityOpen = [
    "Geno: Welcome to the Florida Buzz Disney podcast. I'm Geno. I've been going since I was eighteen months old — over fifty years ago. Thank you for joining us. Let's go.",
  ].join('\n');
  assert.throws(() => assertScriptOpenShape(longevityOpen), /eighteen months|fifty years|longevity/i);
});

test('generateConversation rejects scripts that skip the named show open', async () => {
  const pad = Array.from({ length: 320 }, (_, i) =>
    `Geno: Point ${i} about parks and planning for families this week.`
  ).join('\n');
  const badScript = [
    'Geno: Okay, how was your week? Rain everywhere.',
    pad,
  ].join('\n');
  await assert.rejects(
    () =>
      generateConversation({
        aiText: {
          generateText: async () => badScript,
        },
        show: { title: 'Florida Buzz: Disney' },
        episode: { title: 'Open shape fail', description: 'Desc' },
        outline: '1. Named Open',
        sources: [],
      }),
    /Okay, how was your week/i
  );
});

test('full-episode prompts keep solo Geno host bible and structure', () => {
  assert.equal(HOST_STYLE, 'solo_casual');
  assert.match(HOST_BIBLE, /Geno/);
  assert.match(HOST_BIBLE, /eighteen months/i);
  assert.match(HOST_BIBLE, /fifty years/i);
  assert.match(HOST_BIBLE, /solo/i);
  assert.match(HOST_BIBLE, /I'm Geno|I'm your host Geno/i);
  assert.match(HOST_BIBLE, /welcome to the Florida Buzz Disney podcast|welcome to Florida Buzz: Disney/i);
  assert.match(HOST_BIBLE, /FORBID saying “unofficial”|never say “unofficial”|HARD BAN saying “unofficial”/i);
  assert.match(HOST_BIBLE, /Let's go/i);
  assert.match(HOST_BIBLE, /maybe you don't|soft-bossy|if you… maybe you/i);
  assert.match(HOST_BIBLE, /HARD BAN repeating the eighteen-months|HARD BAN saying the eighteen-months/i);
  assert.match(HOST_BIBLE, /Quick Hits|quick hits/i);
  assert.match(HOST_BIBLE, /Deep Dive|deep dive/i);
  assert.match(HOST_BIBLE, /HARD BAN/i);
  assert.match(HOST_BIBLE, /Gena|Diane/);
  assert.match(HOST_BIBLE, /Do NOT cold-open|Never cold-open|do NOT cold-open/i);
  assert.match(HOST_BIBLE, /ElevenLabs audio tags/i);
  assert.match(HOST_BIBLE, /\[warmly\]/);
  assert.match(HOST_BIBLE, /\[conversational\]/);
  assert.match(HOST_BIBLE, /\[chuckles\]/);
  assert.match(HOST_BIBLE, /\[nostalgic\]/);
  assert.match(HOST_BIBLE, /breath groups|Breath groups/i);
  assert.match(HOST_BIBLE, /Undercover Tourist/i);
  assert.match(HOST_BIBLE, /partner mid-roll/i);
  assert.match(HOST_BIBLE, /show notes/i);
  assert.match(HOST_BIBLE, /Dad-friend|dad friend/i);
  assert.match(HOST_BIBLE, /lecture|referee/i);
  assert.match(HOST_BIBLE, /Full stop/i);
  assert.match(HOST_BIBLE, /the mistake is/i);
  assert.match(HOST_BIBLE, /you are allowed/i);
  assert.match(HOST_BIBLE, /everybody \/ somebody|everybody \/ somebody chaos|stacked everybody/i);
  assert.match(HOST_BIBLE, /sunscreen/i);
  assert.match(HOST_BIBLE, /for my crew/i);
  assert.match(HOST_BIBLE, /we \/ I'd|I'd \/ for my crew/i);
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
  assert.match(outline.system, /Never invent breaking-news/);
  assert.match(outline.system, /Geno/);
  assert.match(outline.system, /Named Open/i);
  assert.match(outline.system, /Quick Hits/i);
  assert.match(outline.system, /Deep Dive/i);
  assert.match(outline.system, /I'm Geno|I\'m Geno|your host Geno/i);
  assert.match(outline.system, /Florida Buzz Disney podcast|welcome to Florida Buzz: Disney/i);
  assert.match(outline.system, /maybe you don't|soft-bossy|if you… maybe you/i);
  assert.match(outline.system, /solo/i);
  assert.match(outline.system, /ElevenLabs audio tags|audio tags/i);
  assert.match(outline.system, /Partner mid-roll/i);
  assert.match(outline.system, /Undercover Tourist/i);
  assert.match(outline.system, /Partner outro/i);
  assert.match(outline.system, /dad friend|Dad-friend/i);
  assert.match(outline.system, /HARD BAN lecture|HARD BAN stacked everybody/i);
  assert.match(outline.system, /sunscreen/i);
  assert.doesNotMatch(outline.system, /Lead: Diane/);
  assert.match(outline.user, /solo Geno|Geno Option A/i);
  assert.match(outline.user, /Undercover Tourist/i);
  const conversation = buildConversationPrompt({
    show,
    episode,
    outline: '1. Named Open\n2. Quick Hits\n3. Deep Dive\nAnecdote: mobile order mixup',
    sources,
  });
  assert.match(conversation.system, /not a presenter summarizing articles|not presenters summarizing articles/i);
  assert.match(outline.system, /timeless composite/i);
  assert.doesNotMatch(conversation.user, /AI-generated hosts/i);
  assert.match(conversation.user, /not affiliated with/i);
  assert.match(conversation.system, /The Florida Buzz dot com/i);
  assert.match(conversation.system, /2–4 natural Florida Buzz references/);
  assert.match(conversation.system, /never read long URLs/i);
  assert.match(conversation.system, /STANDALONE EPISODE RULE/i);
  assert.match(conversation.system, /Part 1/);
  assert.match(conversation.system, /SOLO STRUCTURE/i);
  assert.match(conversation.system, /I'm Geno|I\'m Geno|your host Geno/i);
  assert.match(conversation.system, /Florida Buzz Disney podcast|welcome to Florida Buzz: Disney/i);
  assert.match(conversation.system, /HARD BAN dual-host/i);
  assert.match(conversation.system, /maybe you don't|soft-bossy/i);
  assert.match(conversation.system, /ElevenLabs audio tags/i);
  assert.match(conversation.system, /\[warmly\]/);
  assert.match(conversation.system, /\[chuckles\]/);
  assert.match(conversation.system, /Moderate calm audio tags|moderate calm|every other Geno/i);
  assert.match(conversation.system, /audio tags so eleven_v4|Breath groups|every other/i);
  assert.match(conversation.system, /Partner mid-roll/i);
  assert.match(conversation.system, /Undercover Tourist/i);
  assert.match(conversation.system, /REQUIRED mid-episode partner mention/i);
  assert.match(conversation.system, /Soft outro/i);
  assert.match(conversation.system, /Dad-friend|dad-friend|for my crew/i);
  assert.match(conversation.system, /HARD BAN lecture|HARD BAN stacked everybody/i);
  assert.match(conversation.system, /Full stop/i);
  assert.match(conversation.system, /sunscreen/i);
  assert.match(conversation.system, /swimsuit/i);
  assert.match(conversation.user, /Undercover Tourist/i);
  assert.match(conversation.user, /Partner mid-roll direction/i);
  assert.match(conversation.user, /quick hits \+ short Undercover Tourist mid-roll/i);
  assert.match(outline.system, /ONE standalone episode/i);
  assert.match(outline.system, /Resource:/);
  assert.match(conversation.user, /\/wait-times/);
  assert.match(conversation.user, /\/planner/);
  assert.match(conversation.user, /\/dining/);
});

test('outline and conversation prompts require solo Geno structure', () => {
  const show = { title: 'Florida Buzz: Disney' };
  const episode = { title: 'Solo structure check', description: 'Desc' };
  const sources = [];
  const outline = buildOutlinePrompt({ show, episode, sources });
  assert.match(outline.system, /Named Open/i);
  assert.match(outline.system, /Quick Hits/i);
  assert.match(outline.system, /Deep Dive/i);
  assert.doesNotMatch(outline.system, /Lead: Gena/);
  assert.doesNotMatch(outline.system, /Lead: Diane/);
  const conversation = buildConversationPrompt({
    show,
    episode,
    outline: '1. Named Open\n2. Quick Hits\n3. Deep Dive',
    sources,
  });
  assert.match(conversation.system, /SOLO STRUCTURE/i);
  assert.match(conversation.system, /Geno:/);
  assert.doesNotMatch(conversation.system, /Support host mostly short comments/);
  assert.match(HOST_BIBLE, /solo casual|solo_casual|calm casual/i);
  assert.match(conversation.system, /\[conversational\]/);
  assert.match(conversation.system, /breath groups|Breath groups/i);
  assert.match(conversation.system, /HARD BAN saying “unofficial”/i);
  assert.match(conversation.system, /HARD BAN lecture|HARD BAN stacked everybody/i);
  assert.match(conversation.system, /for my crew/i);
});

test('conversation token budget supports a ~20–25 minute script', () => {
  assert.ok(CONVERSATION_MAX_OUTPUT_TOKENS >= 12000);
  assert.ok(CONVERSATION_MIN_WORDS >= 2500);
  assert.ok(CONVERSATION_MIN_WORDS <= 3500);
  const conversation = buildConversationPrompt({
    show: { title: 'Florida Buzz: Disney' },
    episode: { title: 'Test', description: 'Desc' },
    outline: '1. Open',
    sources: [],
  });
  assert.match(conversation.system, /3,000–3,800 spoken words/i);
  assert.match(conversation.user, /Length requirement/i);
});

test('short AI scripts are rejected and continuations can append', async () => {
  assert.equal(countScriptWords('Geno: Hello there.\n\nGeno: Hi back.'), 4);
  const merged = appendContinuation(
    'Geno: We start here.\n\nGeno: Yes.',
    'Geno: And then we keep going about Magic Kingdom crowds.'
  );
  assert.match(merged, /We start here/);
  assert.match(merged, /Magic Kingdom crowds/);

  const namedOpen = `Geno: ${GENO_NAMED_OPEN_OPTION_A}`;

  let calls = 0;
  const aiText = {
    async generateText(system, user, maxTokens) {
      calls += 1;
      assert.ok(maxTokens >= 12000);
      if (calls === 1) {
        return `${namedOpen}\n\nGeno: [conversational] Short open only.`;
      }
      return 'Geno: [upbeat] A little more but still not enough words overall.';
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
    /too short for a ~20–25 minute episode/i
  );
  assert.ok(calls >= 2);
});

test('continuation recovers a full-length script after a short first pass', async () => {
  const pad = (label, n) => {
    const words = [];
    for (let i = 0; i < n; i += 1) words.push(`word${i}`);
    return `${label}: ${words.join(' ')}`;
  };
  const namedOpen = `Geno: ${GENO_NAMED_OPEN_OPTION_A}`;
  let calls = 0;
  const aiText = {
    async generateText(_system, _user, maxTokens) {
      calls += 1;
      assert.ok(maxTokens >= 12000);
      if (calls === 1) {
        return `${namedOpen}\n\n${pad('Geno', 80)}`;
      }
      return pad('Geno', 3200);
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

test('script sections split for long episodes and strip Geno prefixes for TTS', () => {
  const lines = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(`Geno: Point number ${i} with enough text to force multiple sections eventually.`);
  }
  const sections = splitScriptIntoSections(lines.join('\n'), 400);
  assert.ok(sections.length > 1);
  assert.doesNotMatch(formatScriptForTts(sections[0]), /^Geno:/m);
  assert.match(formatScriptForTts(sections[0]), /Point number/i);
  assert.ok(sections[0].split('\n').length >= 2);
  assert.doesNotMatch(formatScriptForTts(sections[0]), /\n\n/);
});

test('formatScriptForTts and ElevenLabs client preserve emotion audio tags', async () => {
  const tagged = [
    `Geno: ${GENO_NAMED_OPEN_OPTION_A}`,
    'Geno: [chuckles] Okay, this one is a classic park-day trap.',
    'Geno: [nostalgic] Reminds me of our last Magic Kingdom morning.',
    'Geno: [upbeat] Hit The Florida Buzz dot com for the planner.',
  ].join('\n');
  const formatted = formatScriptForTts(tagged);
  assert.doesNotMatch(formatted, /^Geno:/m);
  assert.match(formatted, /\[conversational\]/);
  assert.match(formatted, /\[warmly\]/);
  assert.match(formatted, /\[chuckles\]/);
  assert.match(formatted, /\[nostalgic\]/);
  assert.match(formatted, /\[upbeat\]/);
  assert.doesNotMatch(formatted, /Geno:/);

  let capturedBody = null;
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'true',
    ELEVENLABS_API_KEY: 'sk_test',
    PODCASTS_ELEVEN_VOICE_GENO: 'voice_geno_test',
  });
  const eleven = createElevenTts(cfg, async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'req-test' },
      arrayBuffer: async () => Buffer.from('fake-mp3'),
    };
  });
  await eleven.synthesize(tagged);
  assert.ok(capturedBody);
  assert.match(capturedBody.text, /\[conversational\]/);
  assert.match(capturedBody.text, /\[warmly\]/);
  assert.match(capturedBody.text, /\[chuckles\]/);
  assert.match(capturedBody.text, /\[nostalgic\]/);
  assert.doesNotMatch(capturedBody.text, /^Geno:/m);
  assert.equal(capturedBody.model_id, cfg.elevenModel);
  assert.equal(capturedBody.voice_settings.style, 0);
  assert.equal(capturedBody.voice_settings.use_speaker_boost, false);
  assert.ok(capturedBody.voice_settings.stability <= 0.35);
  assert.ok(capturedBody.voice_settings.speed >= 0.7);
  assert.ok(capturedBody.voice_settings.speed <= 1.2);
});

test('script sections prefer larger multi-turn packs and absorb tiny tails', () => {
  const lines = [];
  for (let i = 0; i < 24; i += 1) {
    lines.push(`Geno: Longer beat ${i} with park talk that fills a bit of space for chunking.`);
  }
  const sections = splitScriptIntoSections(lines.join('\n'), 900, { minTurns: 6 });
  assert.ok(sections.length >= 2);
  for (const section of sections) {
    assert.ok(section.split('\n').length >= 4, 'sections should keep multi-turn packs');
  }
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
  assert.match(xml, /fan podcast/i);
  assert.match(xml, /not affiliated with/i);
  assert.doesNotMatch(xml, /unofficial/i);
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
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'false',
    PODCASTS_TTS_PROVIDER: 'fal',
    FAL_KEY: 'test-key',
  });
  const fal = createFalTts(cfg, async () => {
    throw new Error('network should not be called');
  });
  await assert.rejects(() => fal.submit('Geno: hi there'), /disabled/i);
});

test('fal fallback builds solo Geno single-speaker input', () => {
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'true',
    PODCASTS_TTS_PROVIDER: 'fal',
    FAL_KEY: 'test-key',
  });
  const fal = createFalTts(cfg);
  const input = fal.buildInput('Geno: Hello from the parks');
  assert.equal(input.voice, 'Aoede');
  assert.doesNotMatch(input.prompt, /^Geno:/m);
  assert.match(input.prompt, /Hello from the parks/);
  assert.match(input.style_instructions, /Solo casual|solo casual/i);
  assert.match(input.style_instructions, /Geno/);
  assert.match(input.style_instructions, /quick hits/i);
  assert.match(input.style_instructions, /deep dive/i);
  assert.match(input.style_instructions, /Florida Buzz Disney podcast|thank you for joining/i);
  assert.match(input.style_instructions, /never say unofficial/i);
  assert.match(input.style_instructions, /maybe-you|for my crew/i);
});

test('elevenlabs TTS refuses when generation disabled', async () => {
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'false',
    ELEVENLABS_API_KEY: 'sk_test',
  });
  const eleven = createElevenTts(cfg, async () => {
    throw new Error('network should not be called');
  });
  await assert.rejects(() => eleven.synthesize('Geno: hi'), /disabled/i);
});

test('podcast TTS defaults use ElevenLabs-sized sections', () => {
  const cfg = config({});
  assert.ok(cfg.sectionMaxChars >= 3500);
  assert.ok(cfg.sectionMaxChars <= 5600);
  assert.ok(cfg.temperature >= 0.85);
  assert.equal(cfg.ttsProvider, 'elevenlabs');
});

test('fal TTS style_instructions include EPCOT as EP-cot (shared pronunciation map)', () => {
  const { PRONUNCIATION_MAP, pronunciationStyleInstructions } = require('../lib/podcasts/pronunciation');
  const { HOST_BIBLE } = require('../lib/podcasts/hosts');
  assert.ok(PRONUNCIATION_MAP.some((e) => e.term === 'EPCOT'));
  assert.match(pronunciationStyleInstructions(), /EP-cot/);
  assert.match(pronunciationStyleInstructions(), /never.*letter-by-letter/i);
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'true',
    PODCASTS_TTS_PROVIDER: 'fal',
    FAL_KEY: 'test-key',
  });
  const fal = createFalTts(cfg);
  const input = fal.buildInput('Geno: We hit EPCOT early.');
  assert.match(input.style_instructions, /EPCOT is two syllables, EP-cot/i);
  assert.match(HOST_BIBLE, /EPCOT is pronounced EP-cot/i);
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
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'false',
    ELEVENLABS_API_KEY: 'sk_test',
  });
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    eleven: createElevenTts(cfg),
    ffmpegPath: 'ffmpeg',
  });
  await assert.rejects(
    () => pipeline.generatePreview(episode, `Geno: ${GENO_NAMED_OPEN_OPTION_A}`),
    /PODCASTS_GENERATION_ENABLED/
  );
});

test('memory show seed is solo Geno with hosted-by-Geno cover alt', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  assert.deepEqual(show.hosts, [{ name: 'Geno', role: 'host' }]);
  assert.match(show.cover_alt, /hosted by Geno/i);
  assert.doesNotMatch(show.cover_alt, /Gene Zentko/i);
  assert.match(show.description, /Geno hosts/i);
});

test('RSS itunes:author lists Geno (not Gena & Diane)', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const xml = buildRss({
    site: 'https://thefloridabuzz.com',
    show,
    ownerEmail: 'floridabuzzonline@gmail.com',
    episodes: [],
  });
  assert.match(xml, /<itunes:author>Geno<\/itunes:author>/);
  assert.doesNotMatch(xml, /Gena/);
  assert.doesNotMatch(xml, /Diane/);
});

test('generatePreview uses ElevenLabs solo path with section chunking and intro prepend', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  await store.updateShow(show.id, {
    intro_audio_url: 'https://cdn.example.com/intro-announcer-v7.mp3',
  });
  const episode = await store.createEpisode(show.id, {
    title: 'Eleven path',
    description: 'desc',
    slug: 'eleven-path',
    show_notes_html: '',
    episode_number: 9,
  });
  await store.setStatus(episode.id, 'script_ready');

  const { spawnSync } = require('node:child_process');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const ffmpegPath = (() => {
    try {
      return require('ffmpeg-static');
    } catch {
      return 'ffmpeg';
    }
  })();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-eleven-pipe-'));
  const tinyMp3 = path.join(dir, 'tiny.mp3');
  const mk = spawnSync(
    ffmpegPath,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-codec:a', 'libmp3lame', '-b:a', '96k', tinyMp3],
    { encoding: 'utf8' }
  );
  if (mk.status !== 0) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    return;
  }
  const audioBytes = await fsp.readFile(tinyMp3);

  const lines = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(
      i === 0
        ? `Geno: ${GENO_NAMED_OPEN_OPTION_A}`
        : `Geno: ${i % 5 === 0 ? '[upbeat] ' : ''}Quick hit ${i} with enough park talk about Magic Kingdom crowds, dining, and wait times to force multiple ElevenLabs sections eventually for chunking across a longer solo script.`
    );
  }
  const scriptText = lines.join('\n');

  let elevenCalls = 0;
  const cfg = config({
    PODCASTS_GENERATION_ENABLED: 'true',
    ELEVENLABS_API_KEY: 'sk_test',
    PODCASTS_TTS_PROVIDER: 'elevenlabs',
    PODCASTS_TTS_SECTION_CHARS: '700',
  });
  const eleven = {
    async synthesize() {
      elevenCalls += 1;
      return { buffer: audioBytes, requestId: `req-${elevenCalls}`, model: cfg.elevenModel, voiceId: cfg.elevenVoiceGeno };
    },
  };
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    eleven,
    ffmpegPath,
  });
  const originalLoad = require('../lib/podcasts/audioPipeline').loadIntroBuffer;
  // Inject intro via store URL fetch: stub global fetch for intro download only.
  const prevFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('intro-announcer')) {
      return {
        ok: true,
        arrayBuffer: async () => audioBytes,
        headers: { get: () => null },
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const saved = await pipeline.generatePreview(episode, scriptText);
    assert.ok(elevenCalls >= 2, 'long script should synthesize in multiple ElevenLabs sections');
    assert.ok(saved.buffer.length > 500);
    const fresh = await store.getEpisodeById(episode.id);
    assert.equal(fresh.status, 'preview_ready');
    assert.ok(fresh.audio_url);
    const jobs = await store.listJobs(episode.id);
    assert.equal(jobs[0].status, 'complete');
    assert.equal(jobs[0].result.tts_provider, 'elevenlabs');
    assert.equal(jobs[0].result.intro_attached, true);
    assert.equal(jobs[0].result.eleven_voice, DEFAULT_ELEVEN_VOICE_GENO);
  } finally {
    global.fetch = prevFetch;
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    void originalLoad;
  }
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

  const trailer = await store.createEpisode(show.id, {
    title: 'Show Trailer',
    description: 'trailer desc',
    slug: 'trailer-archive',
    show_notes_html: '<p>Trailer</p>',
    episode_number: 0,
  });
  await store.updateEpisode(trailer.id, {
    status: 'approved',
    audio_url: 'https://cdn.example.com/trailer.mp3',
    audio_byte_size: 1024,
    duration_seconds: 90,
    published_at: '2026-10-01T12:00:00.000Z',
  });
  await store.setStatus(trailer.id, 'published');

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
    published_at: '2026-10-11T12:00:00.000Z',
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
    assert.match(showPage.body, /Show Trailer/);
    assert.match(showPage.body, /Episode archive/);
    assert.match(showPage.body, /<audio controls/);
    assert.match(showPage.body, /cdn\.example\.com\/live\.mp3/);
    assert.match(showPage.body, /cdn\.example\.com\/trailer\.mp3/);
    assert.doesNotMatch(showPage.body, /Hidden Draft/);
    assert.match(showPage.body, /fan podcast/i);
    assert.match(showPage.body, /not affiliated with/i);
    assert.doesNotMatch(showPage.body, /unofficial/i);

    const directory = await request(port, 'GET', '/podcasts');
    assert.equal(directory.status, 200);
    assert.match(directory.body, /Episode archive/);
    assert.match(directory.body, /Live Episode/);
    assert.match(directory.body, /Show Trailer/);

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

test('assertRecordingUpload accepts phone audio formats', () => {
  const { assertRecordingUpload } = require('../lib/podcasts/validation');
  assert.equal(
    assertRecordingUpload({ originalname: 'geno-take.m4a', mimetype: 'audio/mp4', size: 1000 }, 10_000_000),
    true
  );
  assert.equal(
    assertRecordingUpload({ originalname: 'voice.wav', mimetype: 'audio/wav', size: 1000 }, 10_000_000),
    true
  );
  assert.throws(
    () => assertRecordingUpload({ originalname: 'notes.txt', mimetype: 'text/plain', size: 10 }, 10_000_000),
    /audio recording/i
  );
  assert.throws(
    () => assertRecordingUpload({ originalname: 'huge.m4a', mimetype: 'audio/mp4', size: 99_000_000 }, 1_000_000),
    /size limit/i
  );
});

test('isolateSpeech posts multipart to ElevenLabs audio-isolation', async () => {
  const { isolateSpeech, ISOLATION_URL } = require('../lib/podcasts/elevenAudioClean');
  const cleaned = Buffer.from('cleaned-audio-bytes');
  let sawUrl = null;
  let sawKey = null;
  const out = await isolateSpeech(Buffer.from('raw-recording'), {
    apiKey: 'sk_test_iso',
    filename: 'geno.m4a',
    fetcher: async (url, opts) => {
      sawUrl = url;
      sawKey = opts.headers['xi-api-key'];
      assert.equal(opts.method, 'POST');
      assert.ok(opts.body);
      return {
        ok: true,
        headers: { get: (name) => (name === 'request-id' ? 'iso-req-1' : null) },
        arrayBuffer: async () => cleaned.buffer.slice(cleaned.byteOffset, cleaned.byteOffset + cleaned.byteLength),
      };
    },
  });
  assert.equal(sawUrl, ISOLATION_URL);
  assert.equal(sawKey, 'sk_test_iso');
  assert.equal(out.requestId, 'iso-req-1');
  assert.equal(Buffer.compare(out.buffer, cleaned), 0);
  await assert.rejects(() => isolateSpeech(Buffer.alloc(0), { apiKey: 'sk' }), /empty/i);
  await assert.rejects(() => isolateSpeech(Buffer.from('x'), {}), /ELEVENLABS_API_KEY/);
});

test('attachCleanedRecording isolates, encodes, and reaches preview_ready', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Human take',
    description: 'desc',
    slug: 'human-take',
    show_notes_html: '',
    episode_number: 21,
  });
  await store.setStatus(episode.id, 'script_ready');

  const { spawnSync } = require('node:child_process');
  const fsp = require('node:fs/promises');
  const os = require('node:os');
  const ffmpegPath = (() => {
    try {
      return require('ffmpeg-static');
    } catch {
      return 'ffmpeg';
    }
  })();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-clean-rec-'));
  const tinyMp3 = path.join(dir, 'tiny.mp3');
  const mk = spawnSync(
    ffmpegPath,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.35', '-codec:a', 'libmp3lame', '-b:a', '96k', tinyMp3],
    { encoding: 'utf8' }
  );
  if (mk.status !== 0) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    return;
  }
  const audioBytes = await fsp.readFile(tinyMp3);

  let isolateCalls = 0;
  const cfg = config({
    ELEVENLABS_API_KEY: 'sk_test',
    PODCASTS_GENERATION_ENABLED: 'false',
  });
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    eleven: createElevenTts(cfg),
    ffmpegPath,
  });
  const result = await pipeline.attachCleanedRecording(episode, Buffer.from('noisy-phone-take'), 'geno.m4a', {
    prependIntro: false,
    isolateFn: async (buf, opts) => {
      isolateCalls += 1;
      assert.equal(opts.filename, 'geno.m4a');
      assert.equal(opts.apiKey, 'sk_test');
      assert.ok(buf.length);
      return { buffer: audioBytes, requestId: 'iso-1' };
    },
  });
  assert.equal(isolateCalls, 1);
  assert.equal(result.cleaned, true);
  assert.equal(result.introAttached, false);
  const after = await store.getEpisodeById(episode.id);
  assert.equal(after.status, 'preview_ready');
  assert.ok(after.audio_url);
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
});

test('admin clean-recording route starts background cleanup', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Clean upload',
    description: 'desc',
    slug: 'clean-upload',
    show_notes_html: '',
    episode_number: 22,
  });
  await store.setStatus(episode.id, 'script_ready');

  let cleanedArgs = null;
  let resolveClean;
  const cleanedDone = new Promise((resolve) => {
    resolveClean = resolve;
  });
  const cfg = config({
    PODCASTS_ENABLED: 'true',
    ADMIN_PASSWORD: 'a-long-test-password',
    ELEVENLABS_API_KEY: 'sk_test',
  });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    '/admin/podcasts',
    createAdminRouter({
      store,
      cfg,
      pipeline: {
        generatePreview: async () => {},
        attachUploadedAudio: async () => {},
        attachCleanedRecording: async (ep, buf, name, opts) => {
          cleanedArgs = { id: ep.id, name, opts, bytes: buf.length };
          resolveClean();
          return { cleaned: true };
        },
      },
      aiText: null,
      env: { ADMIN_PASSWORD: 'a-long-test-password' },
    })
  );
  const { server, port } = await listen(app);
  try {
    const auth = { Authorization: 'Basic ' + Buffer.from('admin:a-long-test-password').toString('base64') };
    const page = await request(port, 'GET', `/admin/podcasts/episodes/${episode.id}`, { headers: auth });
    assert.equal(page.status, 200);
    assert.match(page.body, /clean-recording/);
    assert.match(page.body, /Record yourself/);
    const csrf = (page.body.match(/name="csrf" value="([^"]+)"/) || [])[1];
    assert.ok(csrf);

    const boundary = '----FbCleanBoundary7MA4YWxkTrZu0gW';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="csrf"\r\n\r\n${csrf}\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="prepend_intro"\r\n\r\n0\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="prepend_intro"\r\n\r\n1\r\n` +
          `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="recording"; filename="geno.m4a"\r\n` +
          `Content-Type: audio/mp4\r\n\r\n`
      ),
      Buffer.from('fake-m4a-bytes'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const posted = await request(port, 'POST', `/admin/podcasts/episodes/${episode.id}/clean-recording`, {
      headers: {
        ...auth,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    });
    assert.equal(posted.status, 303);
    assert.match(posted.headers.location || '', /cleaning-started/);
    await Promise.race([cleanedDone, new Promise((_, rej) => setTimeout(() => rej(new Error('cleanup not started')), 2000))]);
    assert.equal(cleanedArgs.id, episode.id);
    assert.equal(cleanedArgs.name, 'geno.m4a');
    assert.equal(cleanedArgs.opts.prependIntro, true);
    assert.equal(cleanedArgs.bytes, Buffer.byteLength('fake-m4a-bytes'));
  } finally {
    server.close();
  }
});
