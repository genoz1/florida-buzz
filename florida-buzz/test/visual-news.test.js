'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createFloridaBuzzVisualVideo,
  loadConfig,
  LIGHTNING_LANE_WORTH_IT,
  DEFAULT_ELEVEN_VOICE_GENO,
} = require('../lib/visualNews');
const { synthesizeElevenV4, TTS_URL } = require('../lib/visualNews/elevenTts');
const { escapeAssText, writeAss, stamp } = require('../lib/visualNews/ffmpeg');
const { generateOverlayAssets, lightningLaneOverlayPlan } = require('../lib/visualNews/overlays');

test('visual news config defaults to eleven_v4 Geno and never marks fal', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.elevenModel, 'eleven_v4');
  assert.equal(cfg.usesFal, false);
  assert.equal(cfg.width, 720);
  assert.equal(cfg.height, 1280);
  assert.equal(cfg.elevenVoiceId, DEFAULT_ELEVEN_VOICE_GENO);
  assert.equal(DEFAULT_ELEVEN_VOICE_GENO, 'bg7PC2IzyIDwYgytMiW1');
  assert.equal(cfg.defaultVoiceName, 'Geno');
});

test('Lightning Lane story is a static slideshow with wallet + long line stills', () => {
  assert.equal(LIGHTNING_LANE_WORTH_IT.presenter, false);
  assert.match(LIGHTNING_LANE_WORTH_IT.spoken, /Follow Florida Buzz\.?\s*$/);
  assert.ok(LIGHTNING_LANE_WORTH_IT.stills.length >= 4);
  assert.equal(LIGHTNING_LANE_WORTH_IT.moneyOverlays, false);
  assert.equal((LIGHTNING_LANE_WORTH_IT.accents || []).length, 0);
  assert.match(LIGHTNING_LANE_WORTH_IT.spoken, /two hundred twenty-nine|wallet/i);
  const files = LIGHTNING_LANE_WORTH_IT.stills.map((s) => s.file);
  assert.ok(files.includes('empty-wallet.jpg'));
  assert.ok(files.includes('long-line.jpg'));
  for (const s of LIGHTNING_LANE_WORTH_IT.stills) {
    assert.ok(fs.existsSync(s.path), `missing still ${s.file}`);
    assert.equal(s.static, true);
  }
  for (const c of LIGHTNING_LANE_WORTH_IT.captions) {
    assert.ok(c.text.split(/\s+/).length <= 6, `caption too wordy: ${c.text}`);
  }
});

test('ASS writer uses large captions, brand, fade, and CTA (no sticker accents)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ass-'));
  const out = path.join(dir, 't.ass');
  writeAss({
    captions: [{ start: 0, end: 2, text: 'RECORD HIGH', highlight: 'RECORD' }],
    duration: 20,
    outPath: out,
    brand: 'THE FLORIDA BUZZ',
    location: 'Walt Disney World',
    ctaEndText: 'Follow Florida Buzz · thefloridabuzz.com',
    accents: [],
  });
  const body = fs.readFileSync(out, 'utf8');
  assert.match(body, /THE FLORIDA BUZZ/);
  assert.match(body, /Walt Disney World/);
  assert.match(body, /\\fad\(/);
  assert.match(body, /Follow Florida Buzz/);
  assert.match(body, /&H00324EFF&/);
  assert.match(body, /Style: Caption,DejaVu Sans,84,/);
  assert.doesNotMatch(body, /MoneyAccent|\$\$\$\$ PRICE HIT/);
  assert.equal(stamp(1.5), '0:00:01.50');
  assert.equal(escapeAssText('a{b}\\c'), 'a b c');
});

test('overlay plan is empty in slideshow mode (no stacked stickers)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ov-'));
  const assets = generateOverlayAssets(dir);
  const plan = lightningLaneOverlayPlan(assets);
  assert.deepEqual(plan, []);
});

test('synthesizeElevenV4 hits ElevenLabs direct URL with eleven_v4 (not fal)', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      headers: { get: () => 'req-1' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
  const result = await synthesizeElevenV4({
    apiKey: 'sk_test',
    voiceId: 'voice1',
    modelId: 'eleven_v4',
    text: '[curious] Hello. Follow Florida Buzz.',
    fetcher,
  });
  assert.equal(result.provider, 'elevenlabs-direct');
  assert.equal(result.model, 'eleven_v4');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//);
  assert.doesNotMatch(calls[0].url, /fal\.ai|fal\.run/i);
  assert.equal(calls[0].body.model_id, 'eleven_v4');
  assert.equal(TTS_URL, 'https://api.elevenlabs.io/v1/text-to-speech');
});

test('createFloridaBuzzVisualVideo rejects presenter stories', async () => {
  await assert.rejects(
    () =>
      createFloridaBuzzVisualVideo({
        story: { ...LIGHTNING_LANE_WORTH_IT, presenter: true },
        env: { ELEVENLABS_API_KEY: 'x' },
      }),
    /rejects AI presenters/
  );
});

test('createFloridaBuzzVisualVideo requires ELEVENLABS_API_KEY when no voicePath', async () => {
  await assert.rejects(
    () =>
      createFloridaBuzzVisualVideo({
        story: LIGHTNING_LANE_WORTH_IT,
        env: {},
        outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-out-')),
      }),
    /ELEVENLABS_API_KEY|does not use FAL_KEY/
  );
});
