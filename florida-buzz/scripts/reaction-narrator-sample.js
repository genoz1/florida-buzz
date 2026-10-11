#!/usr/bin/env node
'use strict';

/**
 * Reaction / storyteller format:
 *   BACKGROUND: static Lightning Lane / park entrance image (full screen)
 *   BOTTOM-RIGHT (~1/4): keyed green-screen cutout of a consistent 30s
 *                       white female host — FULL MOTION (gestures, head,
 *                       body). NOT a frozen still with only the mouth moving.
 *   VO: female narrator over the keyed host
 *
 * Host plate: Mixkit 42635 (woman presenting on chroma — no mic).
 * Env: ELEVENLABS_API_KEY
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_ID = process.env.ELEVENLABS_VOICE_SAMPLE || 'XrExE9yKIg1WjnnlVkGX'; // Matilda
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-reaction-narrator';

const HOST_DEFAULT = '/tmp/fb-narrator/female/42635.mp4';
const HOST_URL = 'https://assets.mixkit.co/videos/42635/42635-720.mp4';
// Sampled greenscreen ≈ RGB(74,169,81)
const HOST_KEY = 'chromakey=0x4AA951:0.08:0.04,despill=green:mix=0.4:expand=0.05';

const STORY = {
  spoken: `[curious] Lightning Lane Single Pass just hit new highs for November first. Look at this — Big Thunder, Lightning Lane right at the entrance, standby stacked next to it. Same story at Seven Dwarfs. Standby can hit fifty minutes. So is it worth it? Pay only when that wait would wreck your morning and you're already in the park that day. A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 3.2, text: 'Lightning Lane hit new highs' },
    { start: 3.2, end: 7.0, text: 'Look at these entrances' },
    { start: 7.0, end: 10.2, text: 'Standby: 50 minutes' },
    { start: 10.2, end: 13.4, text: 'So is it worth it?' },
    { start: 13.4, end: 17.8, text: 'Pay only if it saves your morning' },
    { start: 17.8, end: 24.0, text: 'Record price ≠ automatic yes' },
  ],
  // Static story image (full-bleed). Prefer Lightning Lane entrance still.
  bgStill: 'big-thunder-lightning-lane.jpg',
};

function ffmpegBin() {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}
function ffprobeBin() {
  try { return require('ffprobe-static').path; } catch { return 'ffprobe'; }
}
function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').slice(-1800)}`);
  }
  return result.stdout;
}
function stamp(seconds) {
  const c = Math.round(seconds * 100);
  return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`;
}
function writeAss(captions, duration, outPath) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,3,1,8,36,200,160,1
Style: Brand,DejaVu Sans,24,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,24,24,28,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
`;
  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,${String(c.text).replace(/[{}\\\r\n]/g, ' ')}\n`;
  }
  fs.writeFileSync(outPath, ass);
}

async function elevenTts({ apiKey, text, outputPath }) {
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  const body = {
    text, model_id: MODEL_ID, language_code: 'en',
    voice_settings: { stability: 0.38, similarity_boost: 0.7, style: 0.55, use_speaker_boost: true },
  };
  let res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && /voice_settings|stability|style/i.test(detail)) {
      res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST', headers,
        body: JSON.stringify({ text, model_id: MODEL_ID, language_code: 'en' }),
        signal: AbortSignal.timeout(120000),
      });
    }
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text().catch(() => detail)).slice(0, 400)}`);
  }
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
}

function audioDuration(file) {
  const n = Number(run(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid audio duration');
  return n;
}

async function ensureHost(narratorPath) {
  if (fs.existsSync(narratorPath)) return;
  fs.mkdirSync(path.dirname(narratorPath), { recursive: true });
  console.log(`Downloading female green-screen host…\n  ${HOST_URL}`);
  const res = await fetch(HOST_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Host clip download failed: ${res.status}`);
  fs.writeFileSync(narratorPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

  const narrator = process.env.NARRATOR_CLIP || HOST_DEFAULT;
  await ensureHost(narrator);

  const bgStill = process.env.BG_IMAGE || path.join(REFS, STORY.bgStill);
  if (!fs.existsSync(bgStill)) throw new Error(`Missing background still: ${bgStill}`);

  const voiceMp3 = path.join(TMP, 'voice.mp3');
  console.log('Synthesizing female narrator VO…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.25, 16), 28);

  const assPath = path.join(TMP, 'captions.ass');
  const captions = STORY.captions.map((c, i, arr) => (i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c));
  writeAss(captions, duration, assPath);

  // 1) STATIC full-screen story background (no Ken Burns / slideshow)
  const bgVideo = path.join(TMP, 'story-bg.mp4');
  const frames = Math.round(duration * 30);
  console.log(`Building static story background (${duration.toFixed(1)}s)…`);
  run(ffmpegBin(), [
    '-y', '-loop', '1', '-i', bgStill,
    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,format=yuv420p',
    '-frames:v', String(frames),
    '-r', '30',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    bgVideo,
  ]);

  // 2) FULL-MOTION host plate looped — gestures / head / body move (not a still)
  const hostMotion = path.join(TMP, 'host-motion.mp4');
  console.log('Preparing full-motion green-screen host…');
  run(ffmpegBin(), [
    '-y',
    '-stream_loop', '-1',
    '-i', narrator,
    '-t', String(duration),
    '-vf',
    // Keep her on the left of the plate (person ~x=92–712), full upper body
    'scale=-1:900,crop=620:900:70:0,fps=30,format=yuv420p',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    hostMotion,
  ]);

  // 3) Key green → transparent cutout, flip so she points toward story, big BR quarter
  const keyed = path.join(TMP, 'host-keyed.mov');
  console.log('Keying green-screen cutout (full motion, no box)…');
  run(ffmpegBin(), [
    '-y', '-i', hostMotion,
    '-vf', [
      HOST_KEY,
      'format=rgba',
      'hflip',
      // Bottom-right ~1/4 of 720x1280
      'scale=440:-1',
    ].join(','),
    '-c:v', 'qtrle',
    '-an',
    keyed,
  ]);

  // 4) Composite: static story + stationary cutout anchored bottom-right
  const composited = path.join(TMP, 'composited.mp4');
  console.log('Compositing…');
  run(ffmpegBin(), [
    '-y',
    '-i', bgVideo,
    '-i', keyed,
    '-filter_complex',
    '[0:v][1:v]overlay=W-w-4:H-h-8:format=auto[v]',
    '-map', '[v]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-t', String(duration),
    composited,
  ]);

  const master = path.join(OUT_DIR, 'reaction-narrator-sample.mp4');
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  run(ffmpegBin(), [
    '-y',
    '-i', composited,
    '-i', voiceMp3,
    '-vf', `ass=${assEscaped},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    master,
  ]);

  for (const t of [2, 5, 8, 12, 16]) {
    run(ffmpegBin(), [
      '-y', '-ss', String(t), '-i', master, '-frames:v', '1',
      path.join(OUT_DIR, `reaction-narrator-frame-t${t}.jpg`),
    ]);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'reaction-narrator-sample.md'), `# Reaction narrator sample

- **Background:** static Lightning Lane / park entrance image (full screen)
- **Host:** full-motion keyed green-screen cutout, bottom-right ~1/4
  (gestures + body move — not a frozen still with only the mouth animated)
- **VO:** female voice narrating the story

Host identity: Mixkit 42635 (stock until Florida Buzz has a permanent host).
Not Gene.

Run: \`npm run sample:reaction-narrator\`
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    duration,
    format: 'static-bg-full-motion-keyed-cutout',
    hostIdentity: 'mixkit-42635-female-presenter-chroma',
    hostMotion: true,
    frozenStillLipsync: false,
    boxBorder: false,
    micVisible: false,
    geneOnCamera: false,
    background: bgStill,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
}
module.exports = { main, STORY };
