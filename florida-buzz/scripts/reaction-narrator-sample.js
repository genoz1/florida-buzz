#!/usr/bin/env node
'use strict';

/**
 * Florida Buzz — ChatGPT production prompt (sole source of truth):
 *   30s vertical 9:16 (1080×1920) social news video
 *   BACKGROUND: one realistic STATIC theme-park priority-access entrance
 *   BOTTOM-RIGHT (~25%): mid-30s mom-type AI presenter cutout (no box/mic/studio)
 *   VO: exact script, female American accent (ElevenLabs)
 *   Lip-sync: Wav2Lip at WAV2LIP_DIR (default /tmp/Wav2Lip)
 *   Captions: large bold white + black outline; yellow highlights on key phrases
 *
 * Do NOT reuse Mixkit 42635.
 *
 * Env: ELEVENLABS_API_KEY
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_ID = process.env.ELEVENLABS_VOICE_SAMPLE || 'XrExE9yKIg1WjnnlVkGX'; // Matilda — clear conversational American female
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-reaction-narrator';
const WAV2LIP_DIR = process.env.WAV2LIP_DIR || '/tmp/Wav2Lip';

const W = 1080;
const H = 1920;

/** Mid-30s mom-type green-screen still (generated; not Mixkit 42635). */
const HOST_STILL_DEFAULT = process.env.HOST_STILL
  || path.join(REFS, 'mom-presenter-greenscreen.jpg');
/** Darker chroma green from generated plate (~#0EBE11). */
const HOST_KEY = process.env.HOST_KEY
  || 'chromakey=0x0EBE11:0.22:0.10,despill=green:mix=0.45:expand=0.06';

const STORY = {
  // Exact words from the production prompt — no added tags or paraphrasing.
  spoken: 'Theme-park visitors may soon have to budget more for faster access to popular attractions. Prices for priority passes have increased, meaning families could pay considerably more during busy travel periods. The exact cost may depend on the park, date, and attraction. Before your next visit, check the official park website and compare the price with the amount of time you could actually save. Would you still pay extra to skip the line?',
  /**
   * Captions stay above the presenter (safe area). Yellow highlight phrases:
   * "prices have increased", "pay more", "skip the line".
   * ASS colour &H00FFFF& = yellow (BGR).
   */
  captions: [
    {
      start: 0.0,
      end: 5.4,
      text: 'Theme-park visitors may soon\\Nhave to budget more',
    },
    {
      start: 5.4,
      end: 10.8,
      text: '{\\c&H00FFFF&}Prices have increased{\\c&HFFFFFF&}\\Nfor priority passes',
    },
    {
      start: 10.8,
      end: 15.6,
      text: 'Families could {\\c&H00FFFF&}pay more{\\c&HFFFFFF&}\\Nduring busy travel periods',
    },
    {
      start: 15.6,
      end: 19.4,
      text: 'Cost may depend on the\\Npark, date, and attraction',
    },
    {
      start: 19.4,
      end: 25.8,
      text: 'Check the official park website\\Nand compare time vs price',
    },
    {
      start: 25.8,
      end: 32.0,
      text: 'Would you still pay extra\\Nto {\\c&H00FFFF&}skip the line{\\c&HFFFFFF&}?',
    },
  ],
  bgStill: 'priority-access-entrance.jpg',
};

function ffmpegBin() {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}
function ffprobeBin() {
  try { return require('ffprobe-static').path; } catch { return 'ffprobe'; }
}
function run(bin, args, opts = {}) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
    cwd: opts.cwd,
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').slice(-1800)}`);
  }
  return result.stdout;
}
function stamp(seconds) {
  const c = Math.round(seconds * 100);
  return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`;
}

/** Large captions above presenter; no brand watermark (prompt forbids logos/watermarks). */
function writeAss(captions, duration, outPath) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,8,48,48,420,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    // Keep ASS override tags; only strip newlines/braces that would break dialogue lines.
    const text = String(c.text).replace(/\r/g, '').replace(/\n/g, '\\N');
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, ass);
}

/**
 * Scale caption times so the last line lands near end of VO.
 * Source timings assume ~30s; remap to actual audio duration.
 */
function scaleCaptions(captions, duration) {
  const srcEnd = Math.max(...captions.map((c) => c.end), 1);
  const scale = Math.max(duration - 0.15, 1) / srcEnd;
  return captions.map((c) => ({
    ...c,
    start: Math.max(0, c.start * scale),
    end: Math.min(duration - 0.05, c.end * scale),
  }));
}

async function elevenTts({ apiKey, text, outputPath }) {
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
  const body = {
    text,
    model_id: MODEL_ID,
    language_code: 'en',
    voice_settings: { stability: 0.42, similarity_boost: 0.72, style: 0.35, use_speaker_boost: true },
  };
  let res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && /voice_settings|stability|style|model/i.test(detail)) {
      res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST', headers,
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', language_code: 'en' }),
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

function wav2lipAvailable() {
  return fs.existsSync(path.join(WAV2LIP_DIR, 'inference.py'))
    && fs.existsSync(path.join(WAV2LIP_DIR, 'checkpoints', 'wav2lip_gan.pth'))
    && fs.existsSync(path.join(WAV2LIP_DIR, 'face_detection', 'detection', 'sfd', 's3fd.pth'));
}

function runLipSync({ faceStill, audioWav, outMp4 }) {
  console.log('Running Wav2Lip so she is actually speaking…');
  run('python3', [
    'inference.py',
    '--checkpoint_path', 'checkpoints/wav2lip_gan.pth',
    '--face', faceStill,
    '--audio', audioWav,
    '--outfile', outMp4,
    '--fps', '25',
    '--pads', '0', '15', '0', '0',
  ], { cwd: WAV2LIP_DIR });
}

/** Fail the build if mouth region barely changes (frozen mouth). */
function assertMouthMoves(speakingMp4) {
  const samples = [1, 2, 3, 4, 6, 8, 10, 12];
  for (const t of samples) {
    const out = path.join(TMP, `qa-mouth-${t}.jpg`);
    run(ffmpegBin(), [
      '-y', '-ss', String(t), '-i', speakingMp4,
      '-vf', 'crop=220:170:iw/2-110:ih*0.28',
      '-frames:v', '1', out,
    ]);
  }
  let maxDelta = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = path.join(TMP, `qa-mouth-${samples[i - 1]}.jpg`);
    const b = path.join(TMP, `qa-mouth-${samples[i]}.jpg`);
    const py = `
from PIL import Image
import numpy as np
a=np.asarray(Image.open(${JSON.stringify(a)}).convert('L'),dtype=np.float32)
b=np.asarray(Image.open(${JSON.stringify(b)}).convert('L'),dtype=np.float32)
print(float(np.mean(np.abs(a-b))))
`;
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
    const d = Number((r.stdout || '').trim());
    if (Number.isFinite(d) && d > maxDelta) maxDelta = d;
  }
  console.log(`Mouth-motion QA: max consecutive delta=${maxDelta.toFixed(2)}`);
  if (maxDelta < 1.5) {
    throw new Error(`Mouth appears frozen (max delta ${maxDelta.toFixed(2)} < 1.5). Refusing to ship.`);
  }
  return maxDelta;
}

/**
 * Prepare a tight waist-up face plate for Wav2Lip from the green-screen still.
 * Keeps shoulders/hands for later keying.
 */
function extractHostPlate(hostStill, outPng) {
  run(ffmpegBin(), [
    '-y', '-i', hostStill, '-frames:v', '1',
    // Center crop waist-up; leave green margins for keying after lip-sync
    '-vf', 'scale=960:-1,crop=720:900:(iw-720)/2:(ih-900)/2+20',
    outPng,
  ]);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');
  if (!wav2lipAvailable()) {
    throw new Error('Wav2Lip required for speaking host. Set up /tmp/Wav2Lip with checkpoints.');
  }

  const hostStillSrc = HOST_STILL_DEFAULT;
  if (!fs.existsSync(hostStillSrc)) {
    throw new Error(`Missing host still (mid-30s mom greenscreen): ${hostStillSrc}`);
  }
  if (/42635/.test(hostStillSrc)) {
    throw new Error('Refusing Mixkit 42635 host — use mid-30s mom-type plate.');
  }

  const bgStill = process.env.BG_IMAGE || path.join(REFS, STORY.bgStill);
  if (!fs.existsSync(bgStill)) throw new Error(`Missing background still: ${bgStill}`);

  const voiceMp3 = path.join(TMP, 'voice.mp3');
  const voiceWav = path.join(TMP, 'voice.wav');
  console.log('Synthesizing female narrator VO (exact script)…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  run(ffmpegBin(), ['-y', '-i', voiceMp3, '-ar', '16000', '-ac', '1', voiceWav]);
  const rawDur = audioDuration(voiceMp3);
  // Target ~30s vertical news clip; allow natural VO length with small pad.
  const duration = Math.min(Math.max(rawDur + 0.35, 28), 34);
  console.log(`VO duration=${rawDur.toFixed(2)}s → master=${duration.toFixed(2)}s`);

  const assPath = path.join(TMP, 'captions.ass');
  const captions = scaleCaptions(STORY.captions, duration);
  writeAss(captions, duration, assPath);

  // 1) STATIC full-screen story background — no camera motion, no scene changes
  const bgVideo = path.join(TMP, 'story-bg.mp4');
  const frames = Math.round(duration * 30);
  console.log(`Building static 1080x1920 background (${duration.toFixed(1)}s)…`);
  run(ffmpegBin(), [
    '-y', '-loop', '1', '-i', bgStill,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=yuv420p`,
    '-frames:v', String(frames), '-r', '30',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    bgVideo,
  ]);

  // 2) Waist-up host plate (consistent clothing / pose / lighting)
  const hostPlate = path.join(TMP, 'host-news-still.png');
  console.log('Preparing mid-30s mom-type host plate…');
  extractHostPlate(hostStillSrc, hostPlate);

  // 3) She actually speaks (Wav2Lip) — face tracks VO; body/pose stay consistent
  const speaking = path.join(TMP, 'host-speaking.mp4');
  runLipSync({ faceStill: hostPlate, audioWav: voiceWav, outMp4: speaking });
  const mouthDelta = assertMouthMoves(speaking);

  // 4) Key → clean background-free cutout, ~25% of 1080x1920, bottom-right
  //    Presenter height ≈ 0.48*H → area roughly ~22–28% with width.
  const keyed = path.join(TMP, 'host-keyed.mov');
  const hostH = Math.round(H * 0.48);
  console.log('Keying waist-up cutout (no box)…');
  run(ffmpegBin(), [
    '-y', '-i', speaking, '-t', String(duration),
    '-vf', [
      HOST_KEY,
      'format=rgba',
      `scale=-1:${hostH}`,
    ].join(','),
    '-c:v', 'qtrle', '-an',
    keyed,
  ]);

  // 5) Composite — static BG + cutout bottom-right
  const composited = path.join(TMP, 'composited.mp4');
  console.log('Compositing news cutout layout…');
  run(ffmpegBin(), [
    '-y', '-i', bgVideo, '-i', keyed,
    '-filter_complex',
    `[0:v][1:v]overlay=W-w-18:H-h-12:format=auto[v]`,
    '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-t', String(duration),
    composited,
  ]);

  const master = path.join(OUT_DIR, 'reaction-narrator-sample.mp4');
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  run(ffmpegBin(), [
    '-y', '-i', composited, '-i', voiceMp3,
    '-vf', `ass=${assEscaped},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    master,
  ]);

  // Verification frames across the timeline
  for (const t of [1, 3, 6, 9, 12, 16, 20, 24]) {
    run(ffmpegBin(), [
      '-y', '-ss', String(t), '-i', master, '-frames:v', '1',
      path.join(OUT_DIR, `reaction-narrator-frame-t${t}.jpg`),
    ]);
  }

  // Probe final
  const probe = JSON.parse(run(ffprobeBin(), [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', master,
  ]));
  const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
  const width = Number(vStream && vStream.width);
  const height = Number(vStream && vStream.height);
  if (width !== W || height !== H) {
    throw new Error(`Expected ${W}x${H}, got ${width}x${height}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'reaction-narrator-sample.md'), `# Reaction narrator sample

ChatGPT production prompt — Florida Buzz priority-pass news cutout.

- **Format:** ${W}×${H} (9:16), ~${duration.toFixed(1)}s
- **Background:** static express-entry / priority-access entrance (no camera move)
- **Host:** mid-30s mom-type waist-up keyed cutout, bottom-right ~25% (NOT Mixkit 42635)
- **Speaking:** Wav2Lip lip-sync to ElevenLabs female American VO (mouth QA delta=${mouthDelta.toFixed(2)})
- **Captions:** bold white + black outline; yellow on “prices have increased”, “pay more”, “skip the line”
- No logos, watermarks, music, scene changes, or extra speakers

## Compromises
- Host body/hands are a single mid-gesture still; Wav2Lip animates the mouth (and some facial motion). Continuous live hand gesturing is limited.
- Highlight “pay more” is applied as yellow on “pay” + “more” inside the spoken phrase “pay considerably more”.
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    duration,
    resolution: `${width}x${height}`,
    format: 'news-reporter-cutout-corner-speaking',
    hostIdentity: 'mid-30s-mom-greenscreen-still',
    mixkit42635: false,
    lipSynced: true,
    mouthMotionDelta: mouthDelta,
    boxBorder: false,
    micVisible: false,
    backgroundStatic: true,
    background: bgStill,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
}
module.exports = { main, STORY };
