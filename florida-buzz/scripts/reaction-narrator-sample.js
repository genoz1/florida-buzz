#!/usr/bin/env node
'use strict';

/**
 * News-reporter / TikTok cutout format:
 *   BACKGROUND: static story image (full screen)
 *   BOTTOM-RIGHT (~1/4): stationary chest-up keyed cutout of a consistent
 *                       30s white female host — actually speaking (Wav2Lip)
 *                       with NO box, NO mic, NO studio background
 *
 * Matches the “appear in the corner while talking without any background”
 * cutout style (e.g. TikTok overlay/cutout tutorials).
 *
 * Host plate: Mixkit 42635 (chroma presenter — no mic).
 * Lip-sync: Wav2Lip at WAV2LIP_DIR (default /tmp/Wav2Lip).
 *
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
const WAV2LIP_DIR = process.env.WAV2LIP_DIR || '/tmp/Wav2Lip';

const HOST_DEFAULT = '/tmp/fb-narrator/female/42635.mp4';
const HOST_URL = 'https://assets.mixkit.co/videos/42635/42635-720.mp4';
const HOST_KEY = 'chromakey=0x4AA951:0.08:0.04,despill=green:mix=0.4:expand=0.05';
// Face-forward, chest-up still (neutral mouth) — drives Wav2Lip
const HOST_STILL_SS = process.env.HOST_STILL_SS || '3.2';

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
  bgStill: 'big-thunder-lightning-lane.jpg',
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
function writeAss(captions, duration, outPath) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,40,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,3,1,8,36,200,140,1
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
    '--pads', '0', '12', '0', '0',
  ], { cwd: WAV2LIP_DIR });
}

/** Fail the build if mouth region barely changes (frozen mouth). */
function assertMouthMoves(speakingMp4) {
  const samples = [1, 2, 3, 4, 6, 8, 10, 12];
  const crops = [];
  for (const t of samples) {
    const out = path.join(TMP, `qa-mouth-${t}.jpg`);
    run(ffmpegBin(), [
      '-y', '-ss', String(t), '-i', speakingMp4,
      '-vf', 'crop=180:140:110:240',
      '-frames:v', '1', out,
    ]);
    crops.push(fs.readFileSync(out));
  }
  // Compare consecutive JPEG buffers via size/content — use ffmpeg ssim-ish via pixel mean abs
  const { spawnSync: sp } = require('node:child_process');
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
    const r = sp('python3', ['-c', py], { encoding: 'utf8' });
    const d = Number((r.stdout || '').trim());
    if (Number.isFinite(d) && d > maxDelta) maxDelta = d;
  }
  console.log(`Mouth-motion QA: max consecutive delta=${maxDelta.toFixed(2)}`);
  if (maxDelta < 1.5) {
    throw new Error(`Mouth appears frozen (max delta ${maxDelta.toFixed(2)} < 1.5). Refusing to ship.`);
  }
  return maxDelta;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');
  if (!wav2lipAvailable()) {
    throw new Error('Wav2Lip required for speaking host. Set up /tmp/Wav2Lip with checkpoints.');
  }

  const narrator = process.env.NARRATOR_CLIP || HOST_DEFAULT;
  await ensureHost(narrator);

  const bgStill = process.env.BG_IMAGE || path.join(REFS, STORY.bgStill);
  if (!fs.existsSync(bgStill)) throw new Error(`Missing background still: ${bgStill}`);

  const voiceMp3 = path.join(TMP, 'voice.mp3');
  const voiceWav = path.join(TMP, 'voice.wav');
  console.log('Synthesizing female narrator VO…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  run(ffmpegBin(), ['-y', '-i', voiceMp3, '-ar', '16000', '-ac', '1', voiceWav]);
  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.25, 16), 28);

  const assPath = path.join(TMP, 'captions.ass');
  const captions = STORY.captions.map((c, i, arr) => (i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c));
  writeAss(captions, duration, assPath);

  // 1) STATIC full-screen story background
  const bgVideo = path.join(TMP, 'story-bg.mp4');
  const frames = Math.round(duration * 30);
  console.log(`Building static story background (${duration.toFixed(1)}s)…`);
  run(ffmpegBin(), [
    '-y', '-loop', '1', '-i', bgStill,
    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,format=yuv420p',
    '-frames:v', String(frames), '-r', '30',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    bgVideo,
  ]);

  // 2) Stationary chest-up still (news reporter framing)
  const hostStill = path.join(TMP, 'host-news-still.png');
  console.log(`Extracting chest-up host still @ ${HOST_STILL_SS}s…`);
  run(ffmpegBin(), [
    '-y', '-ss', String(HOST_STILL_SS), '-i', narrator, '-frames:v', '1',
    '-vf', 'scale=-1:1100,crop=400:500:220:50',
    hostStill,
  ]);

  // 3) She actually speaks (Wav2Lip)
  const speaking = path.join(TMP, 'host-speaking.mp4');
  runLipSync({ faceStill: hostStill, audioWav: voiceWav, outMp4: speaking });
  const mouthDelta = assertMouthMoves(speaking);

  // 4) Key → cutout, flip toward story, size ≈ bottom-right quarter
  const keyed = path.join(TMP, 'host-keyed.mov');
  console.log('Keying stationary chest-up cutout…');
  run(ffmpegBin(), [
    '-y', '-i', speaking, '-t', String(duration),
    '-vf', [
      HOST_KEY,
      'format=rgba',
      'hflip',
      'scale=400:-1',
    ].join(','),
    '-c:v', 'qtrle', '-an',
    keyed,
  ]);

  // 5) Composite
  const composited = path.join(TMP, 'composited.mp4');
  console.log('Compositing news-reporter layout…');
  run(ffmpegBin(), [
    '-y', '-i', bgVideo, '-i', keyed,
    '-filter_complex',
    '[0:v][1:v]overlay=W-w-6:H-h-10:format=auto[v]',
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

  for (const t of [2, 5, 8, 12]) {
    run(ffmpegBin(), [
      '-y', '-ss', String(t), '-i', master, '-frames:v', '1',
      path.join(OUT_DIR, `reaction-narrator-frame-t${t}.jpg`),
    ]);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'reaction-narrator-sample.md'), `# Reaction narrator sample

TikTok-style cutout corner host (news reporter):
- **Background:** static Lightning Lane / park entrance image
- **Host:** stationary chest-up keyed cutout, bottom-right ~1/4
- **Speaking:** Wav2Lip so mouth tracks the female VO (QA delta=${mouthDelta.toFixed(2)})
- No box, no mic, no studio background

Host identity: Mixkit 42635 (stock until Florida Buzz has a permanent host).
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    duration,
    format: 'news-reporter-cutout-corner-speaking',
    hostIdentity: 'mixkit-42635-female-chroma',
    lipSynced: true,
    mouthMotionDelta: mouthDelta,
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
