#!/usr/bin/env node
'use strict';

/**
 * Watchable sample of the daily Facebook park Reel path.
 *
 * Disney / Lightning Lane only. Uses Magic Kingdom stills already in
 * public/reels/references/ — slow zoom/pan + big on-screen text.
 * Silent/text-only (no AI host, no fal, no wallet stickers).
 *
 * Usage:
 *   npm run sample:facebook-park-reel
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderParkReelFromArticle } = require('../lib/facebookParkReel');

const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-park-reel-sample';

const ARTICLE = {
  slug: 'lightning-lane-record-highs-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  dek: 'Pay only if that wait would wreck your Magic Kingdom morning',
  category: 'theme-parks',
  fb_caption: 'Lightning Lane Single Pass hit new highs. Seven Dwarfs standby was 50 minutes — is the paid lane worth it that day?',
};

const CAPTIONS = [
  { start: 0.0, end: 3.5, text: 'Lightning Lane hit new highs' },
  { start: 3.5, end: 7.0, text: 'Seven Dwarfs Mine Train' },
  { start: 7.0, end: 10.5, text: 'Standby: 50 minutes' },
  { start: 10.5, end: 14.0, text: 'So… is it worth it?' },
  { start: 14.0, end: 17.5, text: 'Pay only if it saves your morning' },
];

const STILLS = [
  path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
  path.join(REFS, 'big-thunder-lightning-lane.jpg'),
];

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function extractFrame(videoPath, atSec, outPath) {
  const result = spawnSync(ffmpegBin(), [
    '-y',
    '-ss', String(atSec),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`frame extract failed: ${(result.stderr || '').slice(-600)}`);
  }
}

async function main() {
  for (const still of STILLS) {
    if (!fs.existsSync(still)) throw new Error(`Missing still: ${still}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const durationSec = 18;
  const rendered = await renderParkReelFromArticle(ARTICLE, {
    outDir: OUT_DIR,
    tmpDir: TMP,
    durationSec,
    imagePaths: STILLS,
    masterFileName: 'florida-buzz-park-reel-sample.mp4',
    captions: CAPTIONS.map((c, i, arr) => (
      i === arr.length - 1 ? { ...c, end: durationSec - 0.1 } : c
    )),
  });

  const frameSpecs = [
    { at: 2, name: 'florida-buzz-park-reel-sample-frame-t2.jpg' },
    { at: 6, name: 'florida-buzz-park-reel-sample-frame-t6.jpg' },
    { at: 11, name: 'florida-buzz-park-reel-sample-frame-t11.jpg' },
    { at: 15, name: 'florida-buzz-park-reel-sample-frame-t15.jpg' },
  ];
  const frames = [];
  for (const spec of frameSpecs) {
    const outPath = path.join(OUT_DIR, spec.name);
    extractFrame(rendered.masterPath, spec.at, outPath);
    frames.push(outPath);
  }

  const mdPath = path.join(OUT_DIR, 'florida-buzz-park-reel-sample.md');
  fs.writeFileSync(mdPath, `# Florida Buzz park Reel sample

## What this video is

A short vertical Reel about **Lightning Lane at Magic Kingdom** — park photos with a slow zoom and pan, plus big on-screen text. Same cheap path the site will use for daily Facebook park/cruise Reels. No talking AI host, no green screen, no money stickers.

**Motion in plain English:** the camera slowly zooms in and drifts across still photos while large captions change.

## Files

- Video: \`florida-buzz-park-reel-sample.mp4\`
- Frames: ${frames.map((f) => `\`${path.basename(f)}\``).join(', ')}

## How daily posting turns on

Code already has the 10:15am Eastern cron. Production still needs these host secrets (DigitalOcean env), then restart/redeploy:

\`\`\`bash
FB_PARK_REEL_ENABLED=true
FB_PARK_REEL_PUBLISH=true
\`\`\`

Also keep the usual Facebook + Supabase credentials, and make sure rendered files under \`public/reels/daily/\` are reachable at \`https://thefloridabuzz.com/reels/daily/<file>.mp4\`.

Manual checks before going live:

\`\`\`bash
DRY_RUN=true npm run facebook:park-reel
FB_PARK_REEL_PUBLISH=true npm run facebook:park-reel
\`\`\`

## Credits

- Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons
- Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons
`);

  console.log(JSON.stringify({
    ok: true,
    master: rendered.masterPath,
    duration: rendered.duration,
    frames,
    mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { ARTICLE, main };
