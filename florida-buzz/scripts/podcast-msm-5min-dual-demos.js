#!/usr/bin/env node
'use strict';

/**
 * Build ~5 minute MSM-style dual demos.
 * Default: Instant Geno + Amy (settled cohost).
 *
 * Required:
 *   ELEVENLABS_API_KEY
 *   PODCASTS_GENERATION_ENABLED=true
 *
 * Usage:
 *   PODCASTS_GENERATION_ENABLED=true node scripts/podcast-msm-5min-dual-demos.js
 *   MSM_DEMO_ONLY=amy PODCASTS_GENERATION_ENABLED=true node scripts/podcast-msm-5min-dual-demos.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { config, DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/podcasts/config');
const { createElevenTts } = require('../lib/podcasts/elevenTts');
const { mixDualLines } = require('../lib/podcasts/dualMix');
const lines = require('./data/msm-demo-5min-lines');

const INSTANT_GENO = DEFAULT_ELEVEN_VOICE_GENO; // bg7PC2IzyIDwYgytMiW1
const AMY = 'OZxMHsGaBmV5pjMIDIn0';
const ELIZA = 'ut2XM2wJyIZLTtW6lFzZ';

const ALL_DEMOS = [
  { slug: 'instant-geno-amy', label: 'Instant Geno + Amy', genaVoice: AMY },
  { slug: 'instant-geno-eliza', label: 'Instant Geno + Eliza', genaVoice: ELIZA },
];

/** Soften premade cohost “lips on mic”. */
const GENA_VOICE_SETTINGS = Object.freeze({
  stability: 0.42,
  similarity_boost: 0.62,
  style: 0,
  use_speaker_boost: false,
});
/** Instant Geno — calm conversational (not Geno 2 PVC hot settings). */
const GENO_VOICE_SETTINGS = Object.freeze({
  stability: 0.35,
  similarity_boost: 0.65,
  style: 0,
  use_speaker_boost: false,
});

function outDir() {
  const dir = process.env.MSM_DEMO_OUT_DIR || '/opt/cursor/artifacts/gena-voice-bakeoff';
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function synthLine(eleven, line, voiceId, prev, next) {
  const isGena = line.speaker === 'Gena';
  return eleven.synthesizeText(line.text, {
    voiceId,
    previousText: prev?.text,
    nextText: next?.text,
    speed: line.text.length < 42 ? 1.04 : /\[thoughtful\]/i.test(line.text) ? 0.93 : 0.98,
    voiceSettings: isGena ? GENA_VOICE_SETTINGS : GENO_VOICE_SETTINGS,
  });
}

async function renderDemo({ eleven, ffmpegPath, demo, dir }) {
  console.log(`\n=== ${demo.label} (${lines.length} lines) ===`);
  const rendered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const voiceId = line.speaker === 'Gena' ? demo.genaVoice : INSTANT_GENO;
    process.stdout.write(`  [${i + 1}/${lines.length}] ${line.speaker}… `);
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const result = await synthLine(eleven, line, voiceId, prev, next);
    console.log(`ok (${result.buffer.length} bytes)`);
    rendered.push({ ...line, buffer: result.buffer, voiceId });
  }

  const finalPath = path.join(dir, `msm-5min-${demo.slug}-balanced.mp3`);
  const mixed = await mixDualLines({
    ffmpegPath,
    lines: rendered,
    outPath: finalPath,
    matchMicDistance: true,
  });

  const scriptPath = path.join(dir, `msm-5min-${demo.slug}.txt`);
  fs.writeFileSync(
    scriptPath,
    [
      `Florida Buzz MSM-style dual demo — ${demo.label}`,
      `Geno voice: ${INSTANT_GENO} (Instant)`,
      `Gena voice: ${demo.genaVoice}`,
      `Approx duration: ${(mixed.totalMs / 1000 / 60).toFixed(2)} min (pre-FX mix timeline)`,
      '',
      ...lines.map((l, idx) => `${idx + 1}. ${l.speaker}: ${l.text}`),
    ].join('\n')
  );

  console.log(`Wrote ${finalPath}`);
  console.log(`Timeline ~${(mixed.totalMs / 1000).toFixed(1)}s`);
  return { finalPath, scriptPath, totalMs: mixed.totalMs, slug: demo.slug, label: demo.label };
}

async function main() {
  const cfg = config({
    ...process.env,
    PODCASTS_GENERATION_ENABLED: process.env.PODCASTS_GENERATION_ENABLED || 'true',
  });
  if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY required');
  if (!cfg.generation) throw new Error('Set PODCASTS_GENERATION_ENABLED=true');

  const eleven = createElevenTts({ ...cfg, elevenVoiceGeno: INSTANT_GENO });
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const dir = outDir();
  const only = String(process.env.MSM_DEMO_ONLY || 'amy')
    .trim()
    .toLowerCase();
  const demos = ALL_DEMOS.filter((d) => !only || only === 'all' || d.slug.includes(only) || d.label.toLowerCase().includes(only));
  if (!demos.length) throw new Error(`No demos matched MSM_DEMO_ONLY=${only}`);
  const outputs = [];
  for (const demo of demos) {
    outputs.push(await renderDemo({ eleven, ffmpegPath, demo, dir }));
  }
  fs.writeFileSync(path.join(dir, 'msm-5min-demos.json'), JSON.stringify(outputs, null, 2));
  console.log('\nAll demos done.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
