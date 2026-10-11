#!/usr/bin/env node
'use strict';

/**
 * Reaction-narrator format sample:
 *   full-screen Disney news / park visual
 *   + corner host (green-screen keyed) talking / pointing at it
 *   + story VO
 *
 * This is the TikTok/Reels style: background content, narrator in the corner.
 * Host is stock green-screen footage (not Gene).
 *
 * Env: ELEVENLABS_API_KEY
 * Narrator clip: set NARRATOR_CLIP or default /tmp/fb-narrator/talk/49581.mp4
 * Background image: set BG_IMAGE or default news screenshot / Seven Dwarfs still
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// Male stock host on green screen → male VO for a natural match
const VOICE_ID = process.env.ELEVENLABS_VOICE_SAMPLE || 'pNInz6obpgDQGcFmaJgB'; // Adam
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-reaction-narrator';

const STORY = {
  spoken: `[curious] Lightning Lane Single Pass just hit new highs for November first. Look at this — Seven Dwarfs, Lightning Lane on one side, standby fifty minutes on the other. So is it worth it? Pay only when that wait would wreck your morning and you're already in the park that day. A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 3.2, text: 'Lightning Lane hit new highs' },
    { start: 3.2, end: 6.8, text: 'Seven Dwarfs — look at this' },
    { start: 6.8, end: 10.2, text: 'Standby: 50 minutes' },
    { start: 10.2, end: 13.4, text: 'So is it worth it?' },
    { start: 13.4, end: 17.8, text: 'Pay only if it saves your morning' },
    { start: 17.8, end: 24.0, text: 'Record price ≠ automatic yes' },
  ],
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
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').slice(-1600)}`);
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
Style: Caption,DejaVu Sans,42,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,3,1,2,36,36,520,1
Style: Brand,DejaVu Sans,26,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,28,28,36,1
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

  const narrator = process.env.NARRATOR_CLIP || '/tmp/fb-narrator/talk/49581.mp4';
  const bgCandidates = [
    process.env.BG_IMAGE,
    '/tmp/fb-narrator/bg-news.jpg',
    path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
  ].filter(Boolean);
  const bg = bgCandidates.find((p) => fs.existsSync(p));
  if (!bg) throw new Error('Missing background image');
  if (!fs.existsSync(narrator)) throw new Error(`Missing narrator clip: ${narrator}`);

  const voiceMp3 = path.join(TMP, 'voice.mp3');
  console.log('Synthesizing narrator VO…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.3, 16), 26);

  const assPath = path.join(TMP, 'captions.ass');
  const captions = STORY.captions.map((c, i, arr) => (i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c));
  writeAss(captions, duration, assPath);

  const bgVideo = path.join(TMP, 'bg.mp4');
  const frames = Math.round(duration * 30);
  console.log(`Building 9:16 background (${duration.toFixed(1)}s)…`);
  run(ffmpegBin(), [
    '-y', '-loop', '1', '-i', bg,
    '-vf', `scale=820:1460,zoompan=z='min(1+0.0008*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30,format=yuv420p`,
    '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', bgVideo,
  ]);

  // Loop narrator clip to cover full duration, chromakey green, place bottom-left.
  const keyed = path.join(TMP, 'narrator-keyed.mov');
  console.log('Keying green-screen narrator…');
  run(ffmpegBin(), [
    '-y',
    '-stream_loop', '-1',
    '-i', narrator,
    '-t', String(duration),
    '-vf',
    // Portrait crop first, then chromakey green → transparent corner host
    // Host stands on the left of the green-screen plate — crop from x=0
    'scale=-1:600,crop=340:600:0:0,chromakey=0x00b140:0.22:0.12,format=rgba',
    '-c:v', 'qtrle', // keeps alpha
    '-an',
    keyed,
  ]);

  const composited = path.join(TMP, 'composited.mp4');
  console.log('Compositing reaction layout…');
  run(ffmpegBin(), [
    '-y',
    '-i', bgVideo,
    '-i', keyed,
    '-filter_complex',
    // Bottom-left corner — classic reaction / “pointing at the screen” layout
    '[0:v][1:v]overlay=20:1280-h-36:format=auto[v]',
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

  fs.writeFileSync(path.join(OUT_DIR, 'reaction-narrator-sample.md'), `# Reaction narrator sample

Format you asked for:
- **Background:** Disney Lightning Lane news / park visual (full screen)
- **Corner:** green-screen narrator keyed in, gesturing / pointing at the story
- **VO:** tells the worth-it story

Not Gene. Stock green-screen host for layout proof.
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    duration,
    format: 'reaction-narrator-corner',
    background: bg,
    narrator,
    geneOnCamera: false,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
}
module.exports = { main, STORY };
