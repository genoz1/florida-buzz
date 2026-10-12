#!/usr/bin/env node
'use strict';

/**
 * Watchable sample of the daily Facebook park Reel path.
 *
 * Full mute-friendly captions = every spoken word on screen in timed phrases.
 * Usage: npm run sample:facebook-park-reel
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  renderParkReelFromArticle,
  stripAudioTags,
  parkReelFirstComment,
  articlePermalink,
  SITE_CTA_SPOKEN,
} = require('../lib/facebookParkReel');
const { DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/visualNews/config');

const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-park-reel-sample';

const SPOKEN = `[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes. [upbeat] Find this story and more at the Florida Buzz dot com.`;

const ARTICLE = {
  slug: 'lightning-lane-record-highs-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  dek: 'Pay only if that wait would wreck your Magic Kingdom morning',
  category: 'theme-parks',
  fb_caption: 'Lightning Lane Single Pass hit new highs. Seven Dwarfs standby was 50 minutes — is the paid lane worth it that day?',
  spoken: SPOKEN,
};

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

function normalizeWords(text) {
  return String(text || '')
    .replace(/\\N/g, ' ')
    .toLowerCase()
    .replace(/[—–…$,]/g, ' ')
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function verifyFullScriptCaptions(spoken, captions) {
  const expected = normalizeWords(stripAudioTags(spoken));
  const actual = normalizeWords(captions.map((c) => c.text).join(' '));
  const missing = expected.filter((w) => !actual.includes(w));
  if (missing.length) {
    throw new Error(
      `Caption verification FAILED — spoken words missing on screen: ${missing.join(', ')}\n`
      + `Expected: ${expected.join(' ')}\n`
      + `Got:      ${actual.join(' ')}`
    );
  }
  // Reject keyword-only style (must include full money phrase + rule sentence bits).
  const joined = actual.join(' ');
  for (const must of [
    'two hundred twenty nine',
    'wreck your morning',
    'automatic yes',
    'florida buzz dot com',
  ]) {
    if (!joined.includes(must)) {
      throw new Error(`Caption verification FAILED — missing full phrase "${must}"`);
    }
  }
  // No beat should end on a dangling weak word mid-clause.
  const WEAK_END = /(?:^|\s)(a|an|the|to|of|and|or|for|with|we're|you're|it's|that's|here's|would)$/i;
  for (const c of captions) {
    const flat = String(c.text).replace(/\\N/g, ' ').replace(/[,.!?]+$/, '').trim();
    if (WEAK_END.test(flat) && !/[.!?]$/.test(String(c.text).trim())) {
      throw new Error(`Caption verification FAILED — dangling mid-phrase beat: "${flat}"`);
    }
  }
  return { ok: true, wordCount: expected.length, beatCount: captions.length };
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
    voicePath,
    withVoice: true,
  });

  const verify = verifyFullScriptCaptions(SPOKEN, rendered.captions);
  console.log('Caption verification:', verify);

  const firstComment = parkReelFirstComment(ARTICLE);
  const storyLink = articlePermalink(ARTICLE);
  if (!firstComment.includes(storyLink)) {
    throw new Error(`First-comment verification FAILED — missing story link ${storyLink}`);
  }
  if (!/florida buzz dot com/i.test(stripAudioTags(rendered.spoken))) {
    throw new Error(`Spoken CTA verification FAILED — expected site CTA: ${SITE_CTA_SPOKEN}`);
  }
  console.log('First comment (would post on Facebook):', firstComment);

  // One frame at the midpoint of EVERY caption beat — must review before shipping.
  const frames = [];
  for (let i = 0; i < rendered.captions.length; i += 1) {
    const c = rendered.captions[i];
    const mid = (Number(c.start) + Number(c.end)) / 2;
    const outPath = path.join(OUT_DIR, `florida-buzz-park-reel-sample-beat-${String(i + 1).padStart(2, '0')}.jpg`);
    extractFrame(rendered.masterPath, mid, outPath);
    frames.push({ path: outPath, at: mid, text: c.text.replace(/\\N/g, ' / ') });
  }

  // Also keep the legacy named spot-checks.
  for (const at of [2, 6, 11, 15]) {
    extractFrame(
      rendered.masterPath,
      at,
      path.join(OUT_DIR, `florida-buzz-park-reel-sample-frame-t${at}.jpg`)
    );
  }

  const mdPath = path.join(OUT_DIR, 'florida-buzz-park-reel-sample.md');
  fs.writeFileSync(mdPath, `# Florida Buzz park Reel sample

## What this video is

Lightning Lane Magic Kingdom Reel: slow zoom/pan on park photos, **Geno voiceover**, and **full-script captions** (every spoken word appears on screen for mute viewing — not keyword hooks).

## Spoken script

${stripAudioTags(SPOKEN)}

## On-screen caption beats (verified)

${rendered.captions.map((c, i) => `${i + 1}. [${c.start.toFixed(2)}–${c.end.toFixed(2)}s] ${String(c.text).replace(/\\N/g, ' / ')}`).join('\n')}

## Verification

- Word coverage: **PASS** (${verify.wordCount} spoken words present across ${verify.beatCount} beats)
- Site CTA spoken + captioned: **PASS** (“${SITE_CTA_SPOKEN}”)
- First comment story link: **PASS**
\`\`\`
${firstComment}
\`\`\`
- Master: \`720x1280\` SAR 1:1 DAR 9:16
- Audio: Geno ElevenLabs \`eleven_v4\`

## Files

- Video: \`florida-buzz-park-reel-sample.mp4\`
- Beat frames: ${frames.map((f) => `\`${path.basename(f.path)}\``).join(', ')}
`);

  console.log(JSON.stringify({
    ok: true,
    master: rendered.masterPath,
    duration: rendered.duration,
    voice: rendered.voice,
    captions: rendered.captions,
    spoken: rendered.spoken,
    firstComment,
    storyLink,
    verify,
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

module.exports = { ARTICLE, SPOKEN, main, verifyFullScriptCaptions };
