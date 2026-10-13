#!/usr/bin/env node
'use strict';

/**
 * Build ~5 minute MSM-style dual demos.
 * Default: Geno 11 + Amy, natural (anti-polish) recipe.
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
const rawLines = require('./data/msm-demo-5min-lines');

const INSTANT_GENO = DEFAULT_ELEVEN_VOICE_GENO; // Geno 11
const AMY = 'OZxMHsGaBmV5pjMIDIn0';
const ELIZA = 'ut2XM2wJyIZLTtW6lFzZ';

const ALL_DEMOS = [
  { slug: 'geno11-amy', label: 'Geno 11 + Amy', genaVoice: AMY },
  { slug: 'geno11-eliza', label: 'Geno 11 + Eliza', genaVoice: ELIZA },
];

/** Strip polish tags that make every line sound staged. Keep laughs only. */
function naturalizeText(text) {
  return String(text || '')
    .replace(/\[conversational\]\s*/gi, '')
    .replace(/\[warmly\]\s*/gi, '')
    .replace(/\[curious\]\s*/gi, '')
    .replace(/\[thoughtful\]\s*/gi, '')
    .replace(/\[overlap\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Irregular gaps so it doesn’t metronome. */
function naturalizeLines(lines) {
  return lines.map((line, i) => {
    const text = naturalizeText(line.text);
    const baseGap = Number(line.gapAfterMs) || 120;
    // jitter ±40%, floor 40ms
    const jitter = 0.6 + ((i * 37) % 80) / 100; // pseudo-vary 0.6–1.4
    const gapAfterMs = Math.max(40, Math.round(baseGap * jitter));
    let overlapPrevMs = line.overlapPrevMs;
    // Add a few extra light overlaps on short Gena reactions
    if (
      !overlapPrevMs &&
      line.speaker === 'Gena' &&
      text.split(/\s+/).length <= 6 &&
      i > 2 &&
      i % 5 === 0
    ) {
      overlapPrevMs = 180 + (i % 3) * 40;
    }
    return { ...line, text, gapAfterMs, overlapPrevMs };
  });
}

function genoSettings(line, index) {
  // Low stability = less “perfect TTS”. Vary so it doesn’t lock one cadence.
  const short = line.text.length < 40;
  const laugh = /\[laughs\]|\[chuckles\]/i.test(line.text);
  return {
    stability: laugh ? 0.22 : short ? 0.28 : 0.32 + (index % 3) * 0.03,
    similarity_boost: 0.58,
    style: 0,
    use_speaker_boost: false,
  };
}

function genaSettings(line, index) {
  // Amy reads “studio sweet” if similarity/stability are high — pull both down.
  const short = line.text.split(/\s+/).length <= 5;
  return {
    stability: short ? 0.3 : 0.34 + (index % 2) * 0.04,
    similarity_boost: 0.5,
    style: 0,
    use_speaker_boost: false,
  };
}

function outDir() {
  const dir = process.env.MSM_DEMO_OUT_DIR || '/opt/cursor/artifacts/gena-voice-bakeoff';
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function synthLine(eleven, line, voiceId, prev, next, index) {
  const isGena = line.speaker === 'Gena';
  return eleven.synthesizeText(line.text, {
    voiceId,
    previousText: prev?.text,
    nextText: next?.text,
    speed: line.text.length < 36 ? 1.06 : /\[laughs\]|\[chuckles\]/i.test(line.text) ? 1.0 : 0.97 + (index % 4) * 0.015,
    voiceSettings: isGena ? genaSettings(line, index) : genoSettings(line, index),
  });
}

async function renderDemo({ eleven, ffmpegPath, demo, dir }) {
  const lines = naturalizeLines(rawLines);
  console.log(`\n=== ${demo.label} (${lines.length} lines, natural recipe) ===`);
  const rendered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const voiceId = line.speaker === 'Gena' ? demo.genaVoice : INSTANT_GENO;
    process.stdout.write(`  [${i + 1}/${lines.length}] ${line.speaker}… `);
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const result = await synthLine(eleven, line, voiceId, prev, next, i);
    console.log(`ok (${result.buffer.length} bytes)`);
    rendered.push({ ...line, buffer: result.buffer, voiceId });
  }

  const finalPath = path.join(dir, `msm-5min-${demo.slug}-balanced.mp3`);
  // Geno 11 + Amy: skip heavy mic-salvage EQ (it reads fake/processed).
  // Loudnorm-only keeps them in the same ballpark without plastic tone.
  const mixed = await mixDualLines({
    ffmpegPath,
    lines: rendered,
    outPath: finalPath,
    matchMicDistance: false,
  });

  const scriptPath = path.join(dir, `msm-5min-${demo.slug}.txt`);
  fs.writeFileSync(
    scriptPath,
    [
      `Florida Buzz MSM-style dual demo — ${demo.label}`,
      `Geno voice: ${INSTANT_GENO} (Instant)`,
      `Gena voice: ${demo.genaVoice}`,
      `Recipe: natural (tags stripped, varied stability, loudnorm-only mix)`,
      `Approx duration: ${(mixed.totalMs / 1000 / 60).toFixed(2)} min`,
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
  const demos = ALL_DEMOS.filter(
    (d) => !only || only === 'all' || d.slug.includes(only) || d.label.toLowerCase().includes(only)
  );
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
