#!/usr/bin/env node
'use strict';

/**
 * Story-reenactment sample (no face of Gene, no static tip card).
 * Uses licensed motion footage + ElevenLabs VO to prove the hook format:
 * "something almost went wrong on a Florida / Disney trip."
 *
 * Custom AI reenactments (Seedance) need FAL_KEY — see docs/story-reenactment.md.
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
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-reenact';
const RAW = path.join(TMP, 'raw');

const STORY = {
  id: 'pool-before-rope-drop',
  title: 'Hotel pool almost ruined rope drop',
  hook: 'people jumping in water → scramble → park-day energy',
  spoken: `[excited] Nobody warns you about this. The kids hit the hotel pool... ten minutes before park open. Splash. Chaos. Suddenly you're sprinting for the car in wet flip-flops. We still made rope drop — barely. Rule: pool after the park. Not before. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 2.4, text: 'Nobody warns you about this' },
    { start: 2.4, end: 5.6, text: 'Kids hit the hotel pool' },
    { start: 5.6, end: 8.8, text: '10 minutes before park open' },
    { start: 8.8, end: 12.2, text: 'Wet flip-flops. Full sprint.' },
    { start: 12.2, end: 16.0, text: 'Pool AFTER the park' },
    { start: 16.0, end: 20.0, text: 'Follow Florida Buzz' },
  ],
  // Source clips must already exist under RAW (downloaded separately).
  beats: [
    {
      file: 'Backflips_into_pool_from_3_metres__vertical_video_.webm',
      ss: 1.2,
      seconds: 5.5,
      credit: 'Backflips into pool (vertical), CC BY 4.0, Wikimedia Commons',
    },
    {
      file: 'People_jumping_from_the_Sous-Terre_bridge.ogv',
      ss: 2.0,
      seconds: 5.0,
      credit: 'People jumping from the Sous-Terre bridge, Wikimedia Commons',
    },
    {
      // Second splash beat keeps the scroll-stop energy through the payoff.
      file: 'Backflips_into_pool_from_3_metres__vertical_video_.webm',
      ss: 11.5,
      seconds: 7.0,
      credit: 'Backflips into pool (vertical), CC BY 4.0, Wikimedia Commons',
    },
  ],
};

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function ffprobeBin() {
  try {
    return require('ffprobe-static').path;
  } catch {
    return 'ffprobe';
  }
}

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${bin} failed: ${(result.stderr || result.stdout || '').slice(-1500)}`);
  }
  return result.stdout;
}

function stamp(seconds) {
  const c = Math.round(seconds * 100);
  const h = Math.floor(c / 360000);
  const m = Math.floor(c / 6000) % 60;
  const s = Math.floor(c / 100) % 60;
  const cs = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
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
Style: Caption,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00101010,&H8C000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,210,1
Style: Brand,DejaVu Sans,26,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,28,28,42,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
`;
  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    const text = String(c.text).replace(/[{}\\\r\n]/g, ' ');
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, ass);
}

async function elevenTts({ apiKey, text, outputPath }) {
  const headers = {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };
  const body = {
    text,
    model_id: MODEL_ID,
    language_code: 'en',
    voice_settings: {
      stability: 0.38,
      similarity_boost: 0.72,
      style: 0.5,
      use_speaker_boost: true,
    },
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

function audioDuration(file) {
  const out = run(ffprobeBin(), [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const n = Number(out.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid audio duration');
  return n;
}

function cutVerticalBeat(src, dest, { ss, seconds }) {
  // Crop/pad to 9:16, scale 720x1280. Real motion only — no freeze frames.
  run(ffmpegBin(), [
    '-y',
    '-ss', String(ss),
    '-t', String(seconds),
    '-i', src,
    '-vf',
    "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p",
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '19',
    dest,
  ]);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

  for (const beat of STORY.beats) {
    const src = path.join(RAW, beat.file);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing source clip: ${src}. Download licensed motion footage into ${RAW} first.`);
    }
  }

  const voiceMp3 = path.join(TMP, 'story-narration.mp3');
  const assPath = path.join(TMP, 'story-captions.ass');
  const concatList = path.join(TMP, 'story-concat.txt');
  const videoOnly = path.join(TMP, 'story-video.mp4');
  const master = path.join(OUT_DIR, 'story-reenactment-sample.mp4');
  const readme = path.join(OUT_DIR, 'story-reenactment-sample.md');

  console.log('Synthesizing story VO…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.35, 16), 22);

  const captions = STORY.captions.map((c, i, arr) => (
    i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c
  ));
  writeAss(captions, duration, assPath);

  // Scale scripted beat lengths to match narration duration.
  const totalBeat = STORY.beats.reduce((s, b) => s + b.seconds, 0);
  const scale = duration / totalBeat;
  const clipPaths = [];
  let used = 0;
  STORY.beats.forEach((beat, i) => {
    const seconds = i === STORY.beats.length - 1
      ? Math.max(2.5, duration - used)
      : Number((beat.seconds * scale).toFixed(3));
    used += seconds;
    const dest = path.join(TMP, `beat-${i}.mp4`);
    console.log(`Cutting beat ${i + 1}: ${seconds.toFixed(2)}s from ${beat.file}`);
    cutVerticalBeat(path.join(RAW, beat.file), dest, { ss: beat.ss, seconds });
    clipPaths.push(dest);
  });

  fs.writeFileSync(concatList, clipPaths.map((p) => `file '${p}'`).join('\n'));
  run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', videoOnly]);

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  console.log('Muxing captions + VO…');
  run(ffmpegBin(), [
    '-y',
    '-i', videoOnly,
    '-i', voiceMp3,
    '-vf', `ass=${assEscaped},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '19',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    master,
  ]);

  const md = `# Story reenactment sample

**File:** \`${path.basename(master)}\`  
**Format:** real motion video + story VO (not static ride photos)  
**On camera:** anonymous stock/licensed people only — not Gene  
**Voice:** ElevenLabs Matilda (\`${VOICE_ID}\`)

## Story

${STORY.title}

${STORY.spoken}

## Why this format

Static park stills do not stop the scroll. This sample uses the pattern you described:
people jumping in water → scramble → payoff — a mini reenactment of a trip story.

## Footage credits

${STORY.beats.map((b) => `- ${b.credit}`).join('\n')}

## Next step for custom AI reenactments

When \`FAL_KEY\` is available, \`scripts/ai-story-reenactment.js\` (Seedance text-to-video)
can generate purpose-built clips for a written story beat instead of stock footage.
`;
  fs.writeFileSync(readme, md);
  console.log(JSON.stringify({
    ok: true,
    master,
    readme,
    duration,
    format: 'motion-story-reenactment',
    onCamera: 'anonymous-licensed-stock-only',
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { STORY, main };
