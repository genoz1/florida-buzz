#!/usr/bin/env node
'use strict';

/**
 * Generate a short Main Street Magic–style dual-host sample with TRUE overlaps.
 *
 * Uses Geno 2 (Professional) + Gena bakeoff voice by default, synthesizes each
 * line separately, loudnorms both to the same LUFS, then mixes with adelay/amix.
 *
 * Required:
 *   ELEVENLABS_API_KEY
 *   PODCASTS_GENERATION_ENABLED=true
 *
 * Optional:
 *   PODCASTS_ELEVEN_VOICE_GENO   (default Geno 2)
 *   PODCASTS_ELEVEN_VOICE_GENA   (default Kiora / Gena Bakeoff)
 *   MSM_SAMPLE_OUT               output mp3 path
 *
 * Usage:
 *   PODCASTS_GENERATION_ENABLED=true node scripts/podcast-msm-dual-sample.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { config, DEFAULT_ELEVEN_VOICE_GENO, DEFAULT_ELEVEN_VOICE_GENA } = require('../lib/podcasts/config');
const { createElevenTts } = require('../lib/podcasts/elevenTts');
const { mixDualLines } = require('../lib/podcasts/dualMix');
const {
  MSM_EPISODE_REF,
  MSM_STYLE_DUAL_SAMPLE_LINES,
  sampleLinesAsScript,
  MSM_DELIVERY_BIBLE,
} = require('../lib/podcasts/deliveryMsm');

function resolveOutDir() {
  const preferred = process.env.MSM_SAMPLE_OUT
    ? path.dirname(path.resolve(process.env.MSM_SAMPLE_OUT))
    : null;
  for (const candidate of [preferred, '/opt/cursor/artifacts/voice-ab', '/tmp/fb-msm-dual'].filter(Boolean)) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      /* next */
    }
  }
  const fallback = path.join(process.cwd(), 'tmp', 'msm-dual');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

async function main() {
  const cfg = config({
    ...process.env,
    PODCASTS_GENERATION_ENABLED: process.env.PODCASTS_GENERATION_ENABLED || 'true',
    PODCASTS_HOST_MODE: 'dual',
  });
  if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY required');
  if (!cfg.generation) throw new Error('Set PODCASTS_GENERATION_ENABLED=true');

  const voiceGeno = cfg.elevenVoiceGeno || DEFAULT_ELEVEN_VOICE_GENO;
  const voiceGena = cfg.elevenVoiceGena || DEFAULT_ELEVEN_VOICE_GENA;
  const eleven = createElevenTts(cfg);
  const outDir = resolveOutDir();
  const outMp3 = process.env.MSM_SAMPLE_OUT
    ? path.resolve(process.env.MSM_SAMPLE_OUT)
    : path.join(outDir, 'msm-style-dual-sample.mp3');
  const outScript = path.join(outDir, 'msm-style-dual-sample.txt');

  console.log('Reference:', MSM_EPISODE_REF.episode);
  console.log('Geno voice:', voiceGeno);
  console.log('Gena voice:', voiceGena);
  console.log('Lines:', MSM_STYLE_DUAL_SAMPLE_LINES.length);

  const rendered = [];
  for (let i = 0; i < MSM_STYLE_DUAL_SAMPLE_LINES.length; i++) {
    const line = MSM_STYLE_DUAL_SAMPLE_LINES[i];
    const voiceId = line.speaker === 'Gena' ? voiceGena : voiceGeno;
    process.stdout.write(`  [${i + 1}/${MSM_STYLE_DUAL_SAMPLE_LINES.length}] ${line.speaker}… `);
    const prev = MSM_STYLE_DUAL_SAMPLE_LINES[i - 1];
    const next = MSM_STYLE_DUAL_SAMPLE_LINES[i + 1];
    const result = await eleven.synthesizeText(line.text, {
      voiceId,
      previousText: prev?.text,
      nextText: next?.text,
      // Slightly quicker on short reactions; thoughtful on long Geno beats
      speed: line.text.length < 40 ? 1.05 : /\[thoughtful\]/i.test(line.text) ? 0.92 : 0.98,
    });
    console.log(`ok (${result.buffer.length} bytes, speed=${result.speed})`);
    rendered.push({ ...line, buffer: result.buffer, voiceId });
  }

  console.log('Mixing with overlaps + matched loudness…');
  const mixed = await mixDualLines({
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    lines: rendered,
    outPath: outMp3,
  });

  fs.writeFileSync(
    outScript,
    [
      MSM_DELIVERY_BIBLE,
      '',
      '--- SAMPLE SCRIPT ---',
      sampleLinesAsScript(),
      '',
      `Audio: ${outMp3}`,
      `Placements: ${JSON.stringify(mixed.placements.map((p) => ({ startMs: p.startMs, durMs: p.durMs })), null, 2)}`,
    ].join('\n')
  );

  console.log('Wrote', outMp3);
  console.log('Wrote', outScript);
  console.log(`Duration ~${(mixed.totalMs / 1000).toFixed(1)}s with ${mixed.lineCount} lines`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
