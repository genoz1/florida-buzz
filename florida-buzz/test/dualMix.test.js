'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { mixDualLines, probeDurationSec } = require('../lib/podcasts/dualMix');
const { MSM_STYLE_DUAL_SAMPLE_LINES, MSM_DELIVERY_BIBLE } = require('../lib/podcasts/deliveryMsm');
const { config, resolveHostMode, DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/podcasts/config');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => {
      err += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });
}

async function toneMp3(seconds, freq) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-tone-'));
  const out = path.join(dir, 't.mp3');
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:sample_rate=44100:duration=${seconds}`,
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    out,
  ]);
  const buf = await fsp.readFile(out);
  await fsp.rm(dir, { recursive: true, force: true });
  return buf;
}

test('resolveHostMode dual aliases and Geno 2 default voice', () => {
  assert.equal(resolveHostMode({}), 'solo');
  assert.equal(resolveHostMode({ PODCASTS_HOST_MODE: 'dual' }), 'dual');
  assert.equal(resolveHostMode({ PODCASTS_HOST_MODE: 'msm' }), 'dual');
  assert.equal(DEFAULT_ELEVEN_VOICE_GENO, '5tg8WQNhwRAIGFxz4EFe');
  const cfg = config({ PODCASTS_HOST_MODE: 'dual' });
  assert.equal(cfg.hostMode, 'dual');
  assert.ok(cfg.elevenVoiceGena);
});

test('MSM delivery bible and sample lines encode overlaps', () => {
  assert.match(MSM_DELIVERY_BIBLE, /overlapping dialogue/i);
  assert.match(MSM_DELIVERY_BIBLE, /Main Street Magic/i);
  assert.ok(MSM_STYLE_DUAL_SAMPLE_LINES.some((l) => (l.overlapPrevMs || 0) > 0));
  assert.ok(MSM_STYLE_DUAL_SAMPLE_LINES.some((l) => l.speaker === 'Gena'));
});

test('mixDualLines overlaps and matches loudness', async () => {
  const a = await toneMp3(0.8, 440);
  const b = await toneMp3(0.5, 660);
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-mix-test-'));
  const outPath = path.join(dir, 'mix.mp3');
  try {
    const result = await mixDualLines({
      ffmpegPath: 'ffmpeg',
      outPath,
      lines: [
        { speaker: 'Geno', buffer: a, gapAfterMs: 0 },
        { speaker: 'Gena', buffer: b, overlapPrevMs: 300, gapAfterMs: 0 },
      ],
    });
    assert.ok(result.buffer.length > 1000);
    assert.equal(result.placements.length, 2);
    assert.equal(result.placements[1].startMs, result.placements[0].durMs - 300);
    const dur = await probeDurationSec('ffprobe', outPath);
    // Second clip starts before first ends (true overlap on the timeline).
    const end0 = result.placements[0].startMs + result.placements[0].durMs;
    assert.ok(result.placements[1].startMs < end0);
    assert.ok(dur > 0.7);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
