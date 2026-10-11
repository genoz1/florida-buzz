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

test('Lightning Lane story has no presenter and ends with Florida Buzz CTA', () => {
  assert.equal(LIGHTNING_LANE_WORTH_IT.presenter, false);
  assert.match(LIGHTNING_LANE_WORTH_IT.spoken, /Follow Florida Buzz\.?\s*$/);
  assert.equal(LIGHTNING_LANE_WORTH_IT.stills.length, 2);
  assert.equal(LIGHTNING_LANE_WORTH_IT.moneyOverlays, true);
  assert.match(LIGHTNING_LANE_WORTH_IT.spoken, /two hundred twenty-nine|wallet/i);
  for (const s of LIGHTNING_LANE_WORTH_IT.stills) {
    assert.ok(fs.existsSync(s.path), `missing still ${s.file}`);
  }
});

test('ASS writer uses large mobile caption size, brand, kinetic fade, and CTA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ass-'));
  const out = path.join(dir, 't.ass');
  writeAss({
    captions: [{ start: 0, end: 2, text: 'Hello highs', highlight: 'highs' }],
    duration: 20,
    outPath: out,
    brand: 'THE FLORIDA BUZZ',
    location: 'Magic Kingdom',
    ctaEndText: 'Follow Florida Buzz · thefloridabuzz.com',
    accents: [{ start: 0.2, end: 1.5, text: '$$$$  PRICE HIT' }],
  });
  const body = fs.readFileSync(out, 'utf8');
  assert.match(body, /THE FLORIDA BUZZ/);
  assert.match(body, /Magic Kingdom/);
  assert.match(body, /\\fad\(/);
  assert.match(body, /Follow Florida Buzz/);
  assert.match(body, /&H00FFFF&/);
  assert.match(body, /Style: Caption,DejaVu Sans,78,/);
  assert.match(body, /MoneyAccent/);
  assert.match(body, /\$\$\$\$ PRICE HIT/);
  assert.equal(stamp(1.5), '0:00:01.50');
  assert.equal(escapeAssText('a{b}\\c'), 'a b c');
});

test('money overlay PNGs generate and plan includes wallet + price badge', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ov-'));
  const assets = generateOverlayAssets(dir);
  assert.ok(fs.existsSync(assets.dollars));
  assert.ok(fs.existsSync(assets.priceBadge));
  assert.ok(fs.existsSync(assets.wallet));
  assert.ok(fs.existsSync(assets.spike));
  const plan = lightningLaneOverlayPlan(assets);
  assert.ok(plan.length >= 4);
  assert.ok(plan.some((p) => p.path === assets.wallet));
  assert.ok(plan.some((p) => p.path === assets.priceBadge));
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
