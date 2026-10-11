#!/usr/bin/env node
'use strict';

/**
 * Sample only: no-face "Disney Right Now" vertical short.
 * Voice = stock ElevenLabs Matilda (not Geno/on-camera).
 * Visuals = licensed Wikimedia Magic Kingdom stills with Ken Burns + tip card.
 * Does not publish. Does not spend fal credits.
 *
 * Env: ELEVENLABS_API_KEY (or source /tmp/fb-tts-bakeoff/eleven.env)
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
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-disney-right-now-sample';

const SCRIPT = {
  id: 'disney-right-now-mk-first-hour',
  title: 'Disney Right Now — Magic Kingdom first hour',
  spoken: `[excited] Disney Right Now. Magic Kingdom tip: rope drop a big headliner first, then swing to a second nearby ride before midday lines stack. Save Lightning Lane for the afternoon choke points — not every attraction. Follow Florida Buzz for more park-day moves.`,
  captions: [
    { start: 0.0, end: 2.2, text: 'Disney Right Now' },
    { start: 2.2, end: 6.4, text: 'Rope drop a headliner first' },
    { start: 6.4, end: 10.8, text: 'Then hit a nearby second ride' },
    { start: 10.8, end: 15.2, text: 'Save Lightning Lane for afternoon' },
    { start: 15.2, end: 19.5, text: 'Follow Florida Buzz' },
  ],
  tipCard: {
    eyebrow: 'DISNEY RIGHT NOW',
    line1: 'Magic Kingdom',
    line2: 'First-hour move',
    body: 'Headliner -> nearby second -> Lightning Lane later',
  },
};

function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
}

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

async function elevenTts({ apiKey, text, outputPath }) {
  const body = {
    text,
    model_id: MODEL_ID,
    language_code: 'en',
    voice_settings: {
      stability: 0.42,
      similarity_boost: 0.72,
      style: 0.4,
      use_speaker_boost: true,
    },
  };
  const headers = {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };
  let res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && /voice_settings|stability|style/i.test(detail)) {
      res = await fetch(`${TTS_URL}/${VOICE_ID}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, model_id: MODEL_ID, language_code: 'en' }),
        signal: AbortSignal.timeout(120000),
      });
    }
    if (!res.ok) {
      const d2 = await res.text().catch(() => detail);
      throw new Error(`ElevenLabs TTS ${res.status}: ${d2.slice(0, 400)}`);
    }
  }
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
}

function stamp(seconds) {
  const c = Math.round(seconds * 100);
  const h = Math.floor(c / 360000);
  const m = Math.floor(c / 6000) % 60;
  const s = Math.floor(c / 100) % 60;
  const cs = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function writeAss(captions, outPath) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,46,&H00FFFFFF,&H00FFFFFF,&H00141414,&H96000000,-1,0,0,0,100,100,0,0,1,3,1,2,48,48,220,1
Style: Brand,DejaVu Sans,28,&H00F2F7FF,&H00FFFFFF,&H00141414,&H78000000,-1,0,0,0,100,100,0,0,1,2,0,8,36,36,48,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:19.50,Brand,,0,0,0,,THE FLORIDA BUZZ
`;
  for (const c of captions) {
    const text = String(c.text).replace(/[{}\\\r\n]/g, ' ');
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(c.end)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, ass);
}

function fontPath(size, color) {
  const pluginRoot = path.resolve(path.dirname(require.resolve('@jimp/plugin-print')), '../..');
  return path.join(
    pluginRoot,
    'fonts',
    'open-sans',
    `open-sans-${size}-${color}`,
    `open-sans-${size}-${color}.fnt`
  );
}

async function renderTipCard(outPath) {
  const { HorizontalAlign, Jimp, loadFont } = require('jimp');
  const rect = (w, h, color) => new Jimp({ width: w, height: h, color });
  const img = rect(720, 1280, 0x0a2d33ff);
  img.composite(rect(720, 220, 0x15525cff), 0, 0);
  img.composite(rect(720, 280, 0x0e3b43ff), 0, 1000);
  img.composite(rect(624, 8, 0xc9a227ff), 48, 48);
  img.composite(rect(592, 520, 0xf5efe3ff), 64, 360);
  img.composite(rect(592, 10, 0xe8492fff), 64, 360);

  const white32 = await loadFont(fontPath(32, 'white'));
  const black32 = await loadFont(fontPath(32, 'black'));
  const white64 = await loadFont(fontPath(64, 'white'));
  const black64 = await loadFont(fontPath(64, 'black'));

  img.print({
    font: white32,
    x: 0,
    y: 120,
    text: { text: 'THE FLORIDA BUZZ', alignmentX: HorizontalAlign.CENTER },
    maxWidth: 720,
  });
  img.print({
    font: white64,
    x: 0,
    y: 190,
    text: { text: 'Disney Right Now', alignmentX: HorizontalAlign.CENTER },
    maxWidth: 720,
  });
  img.print({ font: black32, x: 96, y: 420, text: SCRIPT.tipCard.eyebrow });
  img.print({ font: black64, x: 96, y: 480, text: SCRIPT.tipCard.line1 });
  img.print({ font: black64, x: 96, y: 560, text: SCRIPT.tipCard.line2 });
  img.print({ font: black32, x: 96, y: 680, text: SCRIPT.tipCard.body });
  img.print({ font: black32, x: 96, y: 780, text: 'No face on camera.' });
  img.print({ font: black32, x: 96, y: 830, text: 'Licensed park photos.' });
  img.print({
    font: white32,
    x: 0,
    y: 1120,
    text: { text: 'Not affiliated with Disney', alignmentX: HorizontalAlign.CENTER },
    maxWidth: 720,
  });

  fs.writeFileSync(outPath, await img.getBuffer('image/png'));
}

function runFfmpeg(args) {
  const bin = ffmpegBin();
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || '').slice(-1200)}`);
  }
}

function audioDurationSeconds(file) {
  const ffprobe = (() => {
    try {
      return require('ffprobe-static').path;
    } catch {
      return 'ffprobe';
    }
  })();
  const result = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  const n = Number(result.stdout.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid audio duration');
  return n;
}

async function main() {
  ensureDirs();
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

  const haunted = path.join(REFS, 'magic-kingdom-haunted-mansion.jpg');
  const thunder = path.join(REFS, 'magic-kingdom-big-thunder.jpg');
  if (!fs.existsSync(haunted) || !fs.existsSync(thunder)) {
    throw new Error('Missing licensed park reference stills under public/reels/references');
  }

  const tipCard = path.join(TMP, 'tip-card.png');
  const voiceMp3 = path.join(TMP, 'narration.mp3');
  const assPath = path.join(TMP, 'captions.ass');
  const concatList = path.join(TMP, 'concat.txt');
  const videoOnly = path.join(TMP, 'video-only.mp4');
  const master = path.join(OUT_DIR, 'disney-right-now-sample.mp4');
  const readme = path.join(OUT_DIR, 'disney-right-now-sample.md');

  console.log('Rendering tip card…');
  await renderTipCard(tipCard);

  console.log('Synthesizing Matilda VO (no face / not Geno)…');
  await elevenTts({ apiKey, text: SCRIPT.spoken, outputPath: voiceMp3 });
  const duration = Math.min(Math.max(audioDurationSeconds(voiceMp3) + 0.4, 16), 22);
  const captions = SCRIPT.captions.map((c, i, arr) => {
    if (i === arr.length - 1) return { ...c, end: duration - 0.15 };
    return c;
  });
  writeAss(captions, assPath);

  // Three equal beats: Haunted Mansion → Big Thunder → tip card.
  // Build each clip with an explicit frame count (zoompan d= multiplies per
  // input frame when the still is looped — never rely on -t alone).
  const fps = 25;
  const framesA = Math.round((duration / 3) * fps);
  const framesB = framesA;
  const framesC = Math.max(1, Math.round(duration * fps) - framesA - framesB);
  const clipA = path.join(TMP, 'clip-a.mp4');
  const clipB = path.join(TMP, 'clip-b.mp4');
  const clipC = path.join(TMP, 'clip-c.mp4');

  console.log(`Assembling vertical master (~${duration.toFixed(1)}s, ${framesA}/${framesB}/${framesC} frames)…`);

  function kenBurnsStill(input, output, frames, zoomEnd) {
    runFfmpeg([
      '-y',
      '-loop', '1',
      '-i', input,
      '-vf',
      `scale=800:1422,zoompan=z='min(1+0.0015*on,${zoomEnd})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=${fps},format=yuv420p`,
      '-frames:v', String(frames),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      output,
    ]);
  }

  kenBurnsStill(haunted, clipA, framesA, 1.12);
  kenBurnsStill(thunder, clipB, framesB, 1.1);
  runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', tipCard,
    '-vf', `scale=720:1280,fps=${fps},format=yuv420p`,
    '-frames:v', String(framesC),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    clipC,
  ]);

  fs.writeFileSync(
    concatList,
    [`file '${clipA}'`, `file '${clipB}'`, `file '${clipC}'`].join('\n')
  );
  runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatList,
    '-c', 'copy',
    videoOnly,
  ]);

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  runFfmpeg([
    '-y',
    '-i', videoOnly,
    '-i', voiceMp3,
    '-vf', `ass=${assEscaped},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    master,
  ]);

  const md = `# Disney Right Now — sample (no face)

**File:** \`${path.basename(master)}\`  
**Voice:** ElevenLabs Matilda (\`${VOICE_ID}\`) — stock voice, not Geno, nobody on camera  
**Length:** ~${duration.toFixed(1)}s · 720×1280

## Will it have the actual park in it?

**This sample: yes — real Magic Kingdom still photos**, licensed from Wikimedia Commons:
- Haunted Mansion exterior (HarshLight, CC BY 2.0)
- Big Thunder Mountain (daryl_mitchell, CC BY-SA 2.0)

Those are the same reference stills under \`public/reels/references/\`.

**Automated production reels (when enabled):** AI motion clips guided by those licensed park references, plus an illustrative-footage label — not scraped live park video and not Disney trademark art. No person on camera.

## Buzz Board opinion posts

Paused. Resume only with \`BUZZ_BOARD_SOCIAL_ENABLED=true\` **and** \`BUZZ_BOARD_OPINION_SOCIAL_ENABLED=true\`.

## Script

${SCRIPT.spoken}
`;
  fs.writeFileSync(readme, md);
  console.log(JSON.stringify({
    ok: true,
    master,
    readme,
    voice: VOICE_ID,
    duration,
    parkVisuals: 'licensed Wikimedia Magic Kingdom stills',
    onCamera: false,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { SCRIPT, main };
