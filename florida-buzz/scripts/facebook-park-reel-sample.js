#!/usr/bin/env node
'use strict';

/**
 * Watchable sample of the daily Facebook park Reel path.
 *
 * Disney / Lightning Lane only. Uses Magic Kingdom stills already in
 * public/reels/references/ — slow zoom/pan + Geno ElevenLabs VO + captions
 * aligned to the spoken script. No AI host, no fal, no wallet stickers.
 *
 * Usage:
 *   npm run sample:facebook-park-reel
 *
 * Prefers live Geno TTS when ELEVENLABS_API_KEY is set. Otherwise reuses a
 * prebaked Geno mp3 (same voice id bg7PC2IzyIDwYgytMiW1) if present.
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderParkReelFromArticle } = require('../lib/facebookParkReel');
const { DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/visualNews/config');

const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-park-reel-sample';

const SPOKEN = `[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes. Follow Florida Buzz.`;

const ARTICLE = {
  slug: 'lightning-lane-record-highs-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  dek: 'Pay only if that wait would wreck your Magic Kingdom morning',
  category: 'theme-parks',
  fb_caption: 'Lightning Lane Single Pass hit new highs. Seven Dwarfs standby was 50 minutes — is the paid lane worth it that day?',
  spoken: SPOKEN,
};

/** Caption beats match the spoken script (scaled to real audio duration). */
const CAPTIONS = [
  { start: 0.0, end: 3.2, text: 'Lightning Lane\\Nhit new highs' },
  { start: 3.2, end: 6.4, text: 'Up to $229' },
  { start: 6.4, end: 9.6, text: 'Seven Dwarfs\\NMine Train' },
  { start: 9.6, end: 12.4, text: 'Standby:\\N50 minutes' },
  { start: 12.4, end: 15.2, text: 'So… is it\\Nworth it?' },
  { start: 15.2, end: 19.0, text: 'Pay only if it\\Nsaves your morning' },
  { start: 19.0, end: 23.0, text: 'Record price\\N≠ auto yes' },
];

const STILLS = [
  path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
  path.join(REFS, 'big-thunder-lightning-lane.jpg'),
];

const PREBAKED_VOICE_CANDIDATES = [
  process.env.PARK_REEL_VOICE_PATH,
  path.join(OUT_DIR, 'florida-buzz-park-reel-geno-voice.mp3'),
  '/tmp/fb-visual-news-ll-clean/voice.mp3',
  '/tmp/fb-visual-news-ll/voice.mp3',
].filter(Boolean);

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

function resolveVoicePath() {
  if (process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY) return null;
  for (const candidate of PREBAKED_VOICE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Missing ELEVENLABS_API_KEY and no prebaked Geno voice found. '
    + 'Set ELEVENLABS_API_KEY or PARK_REEL_VOICE_PATH.'
  );
}

async function main() {
  for (const still of STILLS) {
    if (!fs.existsSync(still)) throw new Error(`Missing still: ${still}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const voicePath = resolveVoicePath();
  if (voicePath) {
    console.log(`Using prebaked Geno VO: ${voicePath}`);
  } else {
    console.log(`Synthesizing Geno VO (${DEFAULT_ELEVEN_VOICE_GENO}) via ElevenLabs eleven_v4…`);
  }

  const rendered = await renderParkReelFromArticle(ARTICLE, {
    outDir: OUT_DIR,
    tmpDir: TMP,
    imagePaths: STILLS,
    masterFileName: 'florida-buzz-park-reel-sample.mp4',
    spoken: SPOKEN,
    captions: CAPTIONS,
    voicePath,
    withVoice: true,
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

A short vertical Reel about **Lightning Lane at Magic Kingdom** — park photos with a slow zoom and pan, **Geno voiceover** (ElevenLabs \`eleven_v4\`, voice \`${rendered.voice?.voiceId || DEFAULT_ELEVEN_VOICE_GENO}\`), and big on-screen captions that match what he says. Same cheap path the site will use for daily Facebook park/cruise Reels. No talking AI host, no green screen, no money stickers.

**Motion in plain English:** the camera slowly zooms in and drifts across still photos while Geno narrates and large captions change with the spoken beats.

## Script

${SPOKEN}

## Files

- Video: \`florida-buzz-park-reel-sample.mp4\`
- Frames: ${frames.map((f) => `\`${path.basename(f)}\``).join(', ')}
- Voice: ${rendered.voice?.reused ? 'prebaked Geno mp3' : 'live ElevenLabs Geno TTS'} (${rendered.voice?.model || 'eleven_v4'})

## How daily posting turns on

Code already has the 10:15am Eastern cron. Production still needs these host secrets (DigitalOcean env), then restart/redeploy:

\`\`\`bash
FB_PARK_REEL_ENABLED=true
FB_PARK_REEL_PUBLISH=true
ELEVENLABS_API_KEY=<same Geno key as podcasts>
# optional: PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1
\`\`\`

VO is **on by default** when \`ELEVENLABS_API_KEY\` is set. Set \`FB_PARK_REEL_WITH_VOICE=false\` only if you intentionally want silent renders.

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
    voice: rendered.voice,
    captions: rendered.captions,
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

module.exports = { ARTICLE, SPOKEN, CAPTIONS, main };
