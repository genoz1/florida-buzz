#!/usr/bin/env node
'use strict';

/**
 * Lightning Lane visual-news sample (no AI presenter).
 *
 * Pipeline: ElevenLabs eleven_v4 (direct) + local ffmpeg Ken Burns / kinetic captions.
 * Does NOT use fal.ai / FAL_KEY.
 *
 * Env:
 *   ELEVENLABS_API_KEY   required (unless VISUAL_NEWS_REUSE_VOICE=path)
 *   ELEVENLABS_MODEL_ID  optional, default eleven_v4
 *   ELEVENLABS_VOICE_SAMPLE optional voice id
 *   SAMPLE_OUT_DIR       default /opt/cursor/artifacts
 */

require('dotenv').config();

const path = require('node:path');
const { createFloridaBuzzVisualVideo, LIGHTNING_LANE_WORTH_IT } = require('../lib/visualNews');

async function main() {
  const reuse =
    process.env.VISUAL_NEWS_REUSE_VOICE ||
    (process.env.REUSE_VOICE !== 'false' && pathExists('/tmp/fb-ll-worth-it/ll.mp3')
      ? '/tmp/fb-ll-worth-it/ll.mp3'
      : null);

  // Prefer live ElevenLabs when key present (unless REUSE_VOICE=true forces reuse).
  const forceReuse = String(process.env.REUSE_VOICE || '').toLowerCase() === 'true';
  const hasKey = !!(process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY);
  const voicePath = forceReuse || (!hasKey && reuse) ? reuse : null;

  const result = await createFloridaBuzzVisualVideo({
    story: LIGHTNING_LANE_WORTH_IT,
    outDir: process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts',
    tmpDir: process.env.SAMPLE_TMP_DIR || '/tmp/fb-visual-news-ll',
    outputName: 'florida-buzz-visual-news-ll.mp4',
    voicePath: voicePath || undefined,
  });

  console.log(JSON.stringify(result, null, 2));
}

function pathExists(p) {
  try {
    return require('node:fs').existsSync(p);
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
