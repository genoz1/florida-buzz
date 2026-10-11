'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFloridaBuzzVisualVideo, loadConfig, LIGHTNING_LANE_WORTH_IT, DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/visualNews');
const { synthesizeElevenV4, TTS_URL } = require('../lib/visualNews/elevenTts');
const { escapeAssText, writeAss, stamp } = require('../lib/visualNews/ffmpeg');
const { generateOverlayAssets, lightningLaneOverlayPlan } = require('../lib/visualNews/overlays');

test('visual news config defaults to eleven_v4 Geno and never marks fal', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.elevenModel, 'eleven_v4');
  assert.equal(cfg.usesFal, false);
  assert.equal(cfg.elevenVoiceId, DEFAULT_ELEVEN_VOICE_GENO);
  assert.equal(DEFAULT_ELEVEN_VOICE_GENO, 'bg7PC2IzyIDwYgytMiW1');
});

test('Lightning Lane story has no presenter, multi-still cuts, and Florida Buzz CTA', () => {
  assert.equal(LIGHTNING_LANE_WORTH_IT.presenter, false);
  assert.match(LIGHTNING_LANE_WORTH_IT.spoken, /Follow Florida Buzz\.?\s*$/);
  assert.ok(LIGHTNING_LANE_WORTH_IT.stills.length >= 3);
  assert.equal(LIGHTNING_LANE_WORTH_IT.moneyOverlays, false);
  for (const s of LIGHTNING_LANE_WORTH_IT.stills) {
    assert.ok(fs.existsSync(s.path), `missing still ${s.file}`);
    assert.doesNotMatch(s.file, /wallet/i);
  }
});

test('ASS writer uses clean caption size, brand, kinetic fade, and CTA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ass-'));
  const out = path.join(dir, 't.ass');
  writeAss({ captions: [{ start: 0, end: 2, text: 'RECORD HIGH', highlight: 'RECORD' }], duration: 20, outPath: out, brand: 'THE FLORIDA BUZZ', location: 'Magic Kingdom', ctaEndText: 'Follow Florida Buzz · thefloridabuzz.com', accents: [] });
  const body = fs.readFileSync(out, 'utf8');
  assert.match(body, /THE FLORIDA BUZZ/);
  assert.match(body, /Magic Kingdom/);
  assert.match(body, /\\fad\(/);
  assert.match(body, /Follow Florida Buzz/);
  assert.match(body, /&H00324EFF&/);
  assert.match(body, /Style: Caption,Noto Sans Display,64,/);
  assert.doesNotMatch(body, /MoneyAccent|\$\$\$\$ PRICE HIT|EMPTY WALLET/);
  assert.equal(stamp(1.5), '0:00:01.50');
  assert.equal(escapeAssText('a{b}\\c'), 'a b c');
});

test('overlay assets are a single premium price callout + brand pill + scrim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-ov-'));
  const assets = generateOverlayAssets(dir);
  assert.ok(fs.existsSync(assets.priceCallout));
  assert.ok(fs.existsSync(assets.brandPill));
  assert.ok(fs.existsSync(assets.captionScrim));
  const plan = lightningLaneOverlayPlan(assets);
  assert.ok(plan.some((p) => p.path === assets.priceCallout));
  assert.ok(!plan.some((p) => /wallet|dollars|spike/i.test(p.path)));
});

test('synthesizeElevenV4 hits ElevenLabs direct URL with eleven_v4 (not fal)', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, headers: { get: () => 'req-1' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const result = await synthesizeElevenV4({ apiKey: 'sk_test', voiceId: 'voice1', modelId: 'eleven_v4', text: '[curious] Hello. Follow Florida Buzz.', fetcher });
  assert.equal(result.provider, 'elevenlabs-direct');
  assert.equal(result.model, 'eleven_v4');
  assert.match(calls[0].url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//);
  assert.doesNotMatch(calls[0].url, /fal\.ai|fal\.run/i);
  assert.equal(TTS_URL, 'https://api.elevenlabs.io/v1/text-to-speech');
});

test('createFloridaBuzzVisualVideo rejects presenter stories', async () => {
  await assert.rejects(() => createFloridaBuzzVisualVideo({ story: { ...LIGHTNING_LANE_WORTH_IT, presenter: true }, env: { ELEVENLABS_API_KEY: 'x' } }), /rejects AI presenters/);
});

test('createFloridaBuzzVisualVideo requires ELEVENLABS_API_KEY when no voicePath', async () => {
  await assert.rejects(() => createFloridaBuzzVisualVideo({ story: LIGHTNING_LANE_WORTH_IT, env: {}, outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fb-vn-out-')) }), /ELEVENLABS_API_KEY|does not use FAL_KEY/);
});
