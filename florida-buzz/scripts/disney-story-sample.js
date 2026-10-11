#!/usr/bin/env node
'use strict';

/**
 * Disney-trip story sample — Magic Kingdom visuals + a real park-day mistake.
 * No Gene on camera. No generic pool/bridge filler.
 *
 * Env: ELEVENLABS_API_KEY
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_ID = process.env.ELEVENLABS_VOICE_SAMPLE || 'XrExE9yKIg1WjnnlVkGX';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const ROOT = path.join(__dirname, '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');
const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-disney-story';

const STORY = {
  id: 'mk-wrong-first-ride',
  title: 'Magic Kingdom: the wrong first ride',
  spoken: `[excited] Magic Kingdom tip that costs people their whole morning. We rope-dropped... and walked the wrong way first. Big Thunder was a walk-on. Seven Dwarfs was already seventy-five minutes. Your first ride sets the day. Don't waste rope drop on the wrong side of the park. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 2.6, text: 'Magic Kingdom mistake' },
    { start: 2.6, end: 6.0, text: 'We rope-dropped...' },
    { start: 6.0, end: 9.4, text: 'and walked the wrong way' },
    { start: 9.4, end: 12.8, text: 'Big Thunder: walk-on' },
    { start: 12.8, end: 16.4, text: 'Seven Dwarfs: 75 minutes' },
    { start: 16.4, end: 21.0, text: "Don't waste rope drop" },
  ],
  stills: [
    {
      file: 'magic-kingdom-big-thunder.jpg',
      label: 'Big Thunder Mountain — Magic Kingdom',
      credit: 'daryl_mitchell, CC BY-SA 2.0, Wikimedia Commons',
    },
    {
      file: 'magic-kingdom-haunted-mansion.jpg',
      label: 'Haunted Mansion — Magic Kingdom',
      credit: 'HarshLight, CC BY 2.0, Wikimedia Commons',
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
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').slice(-1200)}`);
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
Style: Caption,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00101010,&H8C000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,220,1
Style: Brand,DejaVu Sans,26,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,28,28,42,1
Style: Loc,DejaVu Sans,22,&H00E8F0FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,36,36,70,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
Dialogue: 0,0:00:00.00,${stamp(duration / 2)},Loc,,0,0,0,,Magic Kingdom
Dialogue: 0,${stamp(duration / 2)},${stamp(duration)},Loc,,0,0,0,,Magic Kingdom
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
      stability: 0.4,
      similarity_boost: 0.72,
      style: 0.48,
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

function kenBurns(input, output, frames, zoomEnd) {
  const fps = 30;
  run(ffmpegBin(), [
    '-y',
    '-loop', '1',
    '-i', input,
    '-vf',
    `scale=900:1600,zoompan=z='min(1+0.0012*on,${zoomEnd})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=${fps},format=yuv420p`,
    '-frames:v', String(frames),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    output,
  ]);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');

  for (const still of STORY.stills) {
    const p = path.join(REFS, still.file);
    if (!fs.existsSync(p)) throw new Error(`Missing Magic Kingdom still: ${p}`);
  }

  const voiceMp3 = path.join(TMP, 'disney-story.mp3');
  const assPath = path.join(TMP, 'disney-story.ass');
  const concatList = path.join(TMP, 'disney-concat.txt');
  const videoOnly = path.join(TMP, 'disney-video.mp4');
  const master = path.join(OUT_DIR, 'disney-story-sample.mp4');
  // Replace the bad generic sample name so the latest artifact is Disney.
  const alsoAs = path.join(OUT_DIR, 'story-reenactment-sample.mp4');
  const readme = path.join(OUT_DIR, 'disney-story-sample.md');

  console.log('Synthesizing Magic Kingdom story VO…');
  await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.3, 16), 24);
  const captions = STORY.captions.map((c, i, arr) => (
    i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c
  ));
  writeAss(captions, duration, assPath);

  const fps = 30;
  const totalFrames = Math.round(duration * fps);
  const framesA = Math.floor(totalFrames / 2);
  const framesB = totalFrames - framesA;
  const clipA = path.join(TMP, 'mk-a.mp4');
  const clipB = path.join(TMP, 'mk-b.mp4');

  console.log(`Building Magic Kingdom visuals (${duration.toFixed(1)}s)…`);
  kenBurns(path.join(REFS, STORY.stills[0].file), clipA, framesA, 1.14);
  kenBurns(path.join(REFS, STORY.stills[1].file), clipB, framesB, 1.12);

  fs.writeFileSync(concatList, [`file '${clipA}'`, `file '${clipB}'`].join('\n'));
  run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', videoOnly]);

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  run(ffmpegBin(), [
    '-y',
    '-i', videoOnly,
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
  fs.copyFileSync(master, alsoAs);

  fs.writeFileSync(readme, `# Disney story sample

**Story:** ${STORY.title}  
**Visuals:** licensed Magic Kingdom stills (Big Thunder + Haunted Mansion)  
**Not:** generic pool / bridge vacation filler

## Script

${STORY.spoken}

## Credits

${STORY.stills.map((s) => `- ${s.label}: ${s.credit}`).join('\n')}
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    alsoAs,
    duration,
    park: 'Magic Kingdom',
    story: STORY.id,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { STORY, main };
