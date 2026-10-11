#!/usr/bin/env node
'use strict';

/**
 * Lightning Lane visual-news sample — static slideshow (no AI presenter).
 * Beats: pricey rides → empty wallet photo → long line → tip/CTA
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
  if (!process.env.VISUAL_NEWS_ELEVEN_VOICE && !process.env.ELEVENLABS_VOICE_SAMPLE) {
    process.env.VISUAL_NEWS_ELEVEN_VOICE = DEFAULT_ELEVEN_VOICE_GENO;
  }

  const forceReuse = String(process.env.REUSE_VOICE || '').toLowerCase() === 'true';
  const voicePath =
    forceReuse && fs.existsSync('/tmp/fb-visual-news-ll/voice.mp3')
      ? '/tmp/fb-visual-news-ll/voice.mp3'
      : undefined;

  const result = await createFloridaBuzzVisualVideo({
    story: LIGHTNING_LANE_WORTH_IT,
    outDir: process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts',
    tmpDir: process.env.SAMPLE_TMP_DIR || '/tmp/fb-visual-news-ll',
    outputName: 'florida-buzz-visual-news-ll.mp4',
    voicePath,
  });

  const outDir = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
  const master = result.master;
  const ffmpeg = require('../lib/visualNews/ffmpeg');
  for (const t of [1, 4, 8, 11, 15, 19]) {
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { main };
