#!/usr/bin/env node
'use strict';

/**
 * Lightning Lane visual-news sample (no AI presenter).
 *
 * Pipeline: ElevenLabs eleven_v4 (direct) + local ffmpeg Ken Burns / kinetic captions
 * + one premium $229 callout (no wallet / $$$$ sticker dump).
 * Does NOT use fal.ai / FAL_KEY.
 *
 * Voice default: Geno — ElevenLabs voice id bg7PC2IzyIDwYgytMiW1
 * (same as podcast host; see lib/podcasts/config.js DEFAULT_ELEVEN_VOICE_GENO).
 *
 * Env:
 *   ELEVENLABS_API_KEY   required (unless VISUAL_NEWS_REUSE_VOICE=path)
 *   ELEVENLABS_MODEL_ID  optional, default eleven_v4
 *   VISUAL_NEWS_ELEVEN_VOICE optional override (default Geno)
 *   SAMPLE_OUT_DIR       default /opt/cursor/artifacts
 */

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const {
  createFloridaBuzzVisualVideo,
  LIGHTNING_LANE_WORTH_IT,
  DEFAULT_ELEVEN_VOICE_GENO,
} = require('../lib/visualNews');

async function main() {
  const reuse =
    process.env.VISUAL_NEWS_REUSE_VOICE ||
    (pathExists('/tmp/fb-visual-news-ll/voice.mp3')
      ? '/tmp/fb-visual-news-ll/voice.mp3'
      : pathExists('/tmp/fb-ll-worth-it/ll.mp3')
        ? '/tmp/fb-ll-worth-it/ll.mp3'
        : null);

  // Prefer live ElevenLabs Geno when key present (unless REUSE_VOICE=true forces reuse).
  // Default to live TTS so Geno voice is used — do not silently reuse a prior Matilda bake.
  const forceReuse = String(process.env.REUSE_VOICE || '').toLowerCase() === 'true';
  const hasKey = !!(process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY);
  const voicePath = forceReuse && reuse ? reuse : !hasKey && reuse ? reuse : null;

  // Ensure Geno is the resolved voice unless explicitly overridden.
  if (!process.env.VISUAL_NEWS_ELEVEN_VOICE && !process.env.ELEVENLABS_VOICE_SAMPLE) {
    process.env.VISUAL_NEWS_ELEVEN_VOICE = DEFAULT_ELEVEN_VOICE_GENO;
  }

  const result = await createFloridaBuzzVisualVideo({
    story: LIGHTNING_LANE_WORTH_IT,
    outDir: process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts',
    tmpDir: process.env.SAMPLE_TMP_DIR || '/tmp/fb-visual-news-ll',
    outputName: 'florida-buzz-visual-news-ll.mp4',
    voicePath: voicePath || undefined,
  });

  // Extract verification frames for visual QA.
  const outDir = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
  const master = result.master;
  const ffmpeg = require('../lib/visualNews/ffmpeg');
  for (const t of [2, 4, 7, 10, 12, 17]) {
    const frame = path.join(outDir, `florida-buzz-visual-news-ll-t${t}.jpg`);
    try {
      ffmpeg.run(ffmpeg.ffmpegBin(), [
        '-y',
        '-ss',
        String(t),
        '-i',
        master,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        frame,
      ]);
      result[`frame_t${t}`] = frame;
    } catch (err) {
      result[`frame_t${t}_error`] = String(err.message || err);
    }
  }

  console.log(JSON.stringify({ ...result, genoVoiceId: DEFAULT_ELEVEN_VOICE_GENO }, null, 2));
}

function pathExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { main };
