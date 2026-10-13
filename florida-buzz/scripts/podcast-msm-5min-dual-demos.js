#!/usr/bin/env node
'use strict';

/**
 * Build two ~5 minute MSM-style dual demos:
 *   Geno 2 + Amy
 *   Geno 2 + Eliza
 *
 * Required:
 *   ELEVENLABS_API_KEY
 *   PODCASTS_GENERATION_ENABLED=true
 *
 * Usage:
 *   PODCASTS_GENERATION_ENABLED=true node scripts/podcast-msm-5min-dual-demos.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../lib/podcasts/config');
const { createElevenTts } = require('../lib/podcasts/elevenTts');
const { mixDualLines } = require('../lib/podcasts/dualMix');
const { applyVoicePresence, VOICE_COLD_START_WARMUP, probeMp3DurationSec, trimLeadingAudio } =
  require('../lib/podcasts/audioPipeline');
const lines = require('./data/msm-demo-5min-lines');

const GENO2 = '5tg8WQNhwRAIGFxz4EFe';
const AMY = 'OZxMHsGaBmV5pjMIDIn0';
const ELIZA = 'ut2XM2wJyIZLTtW6lFzZ';

const DEMOS = [
  { slug: 'geno2-amy', label: 'Geno 2 + Amy', genaVoice: AMY },
  { slug: 'geno2-eliza', label: 'Geno 2 + Eliza', genaVoice: ELIZA },
];

function outDir() {
  const dir = process.env.MSM_DEMO_OUT_DIR || '/opt/cursor/artifacts/gena-voice-bakeoff';
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function synthLine(eleven, line, voiceId, prev, next) {
  return eleven.synthesizeText(line.text, {
    voiceId,
    previousText: prev?.text,
    nextText: next?.text,
    speed: line.text.length < 42 ? 1.04 : /\[thoughtful\]/i.test(line.text) ? 0.93 : 0.98,
  });
}

async function renderDemo({ cfg, eleven, ffmpegPath, demo, dir }) {
  console.log(`\n=== ${demo.label} (${lines.length} lines) ===`);
  const rendered = [];
  let genoWarmupSec = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const voiceId = line.speaker === 'Gena' ? demo.genaVoice : GENO2;
    process.stdout.write(`  [${i + 1}/${lines.length}] ${line.speaker}… `);
    const prev = lines[i - 1];
    const next = lines[i + 1];

    let result;
    if (line.speaker === 'Geno' && i === 0) {
      // Cold-start skip for Geno 2 first line only
      const warmup = await eleven.synthesizeText(VOICE_COLD_START_WARMUP, {
        voiceId: GENO2,
        nextText: line.text,
      });
      genoWarmupSec = await probeMp3DurationSec(warmup.buffer, ffmpegPath);
      const combined = await eleven.synthesizeText(`${VOICE_COLD_START_WARMUP}\n\n${line.text}`, {
        voiceId: GENO2,
        previousText: VOICE_COLD_START_WARMUP,
        nextText: next?.text,
      });
      const trimmed = await trimLeadingAudio(combined.buffer, genoWarmupSec, ffmpegPath);
      result = { ...combined, buffer: trimmed };
      console.log(`ok (warmup ${genoWarmupSec.toFixed(1)}s trimmed)`);
    } else {
      result = await synthLine(eleven, line, voiceId, prev, next);
      console.log(`ok (${result.buffer.length} bytes)`);
    }

    rendered.push({ ...line, buffer: result.buffer, voiceId });
  }

  const rawPath = path.join(dir, `msm-5min-${demo.slug}-raw.mp3`);
  const mixed = await mixDualLines({
    ffmpegPath,
    lines: rendered,
    outPath: rawPath,
  });

  // Presence FX on full mix (warmer Geno 2 recipe)
  let finalBuf = mixed.buffer;
  if (cfg.voicePresenceFx !== false) {
    finalBuf = await applyVoicePresence(finalBuf, ffmpegPath);
  }
  const finalPath = path.join(dir, `msm-5min-${demo.slug}.mp3`);
  fs.writeFileSync(finalPath, finalBuf);

  const scriptPath = path.join(dir, `msm-5min-${demo.slug}.txt`);
  fs.writeFileSync(
    scriptPath,
    [
      `Florida Buzz MSM-style dual demo — ${demo.label}`,
      `Geno voice: ${GENO2}`,
      `Gena voice: ${demo.genaVoice}`,
      `Approx duration: ${(mixed.totalMs / 1000 / 60).toFixed(2)} min (pre-FX mix timeline)`,
      `Warmup trimmed from first Geno line: ${genoWarmupSec ? genoWarmupSec.toFixed(2) + 's' : 'n/a'}`,
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

  const eleven = createElevenTts({ ...cfg, elevenVoiceGeno: GENO2 });
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const dir = outDir();
  const outputs = [];
  for (const demo of DEMOS) {
    outputs.push(await renderDemo({ cfg, eleven, ffmpegPath, demo, dir }));
  }
  fs.writeFileSync(path.join(dir, 'msm-5min-demos.json'), JSON.stringify(outputs, null, 2));
  console.log('\nAll demos done.');
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
