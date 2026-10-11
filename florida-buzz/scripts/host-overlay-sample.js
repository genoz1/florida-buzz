#!/usr/bin/env node
'use strict';

/**
 * Same Lightning Lane worth-it story, with a stock host circle overlaid
 * on Magic Kingdom stills (not Gene — anonymous licensed portrait).
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
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-host-overlay';

const STORY = {
  spoken: `[curious] Lightning Lane Single Pass just hit new highs for November first. Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 3.0, text: 'Lightning Lane hit new highs' },
    { start: 3.0, end: 6.2, text: 'Seven Dwarfs Mine Train' },
    { start: 6.2, end: 9.4, text: 'Standby: 50 minutes' },
    { start: 9.4, end: 12.6, text: 'So is it worth it?' },
    { start: 12.6, end: 16.8, text: 'Pay only if it saves your morning' },
    { start: 16.8, end: 24.0, text: 'Record price ≠ automatic yes' },
  ],
  stills: ['seven-dwarfs-mine-train.jpg', 'big-thunder-lightning-lane.jpg'],
  host: 'host-overlay.png',
};

function ffmpegBin() {
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}
function ffprobeBin() {
  try { return require('ffprobe-static').path; } catch { return 'ffprobe'; }
}
function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${path.basename(bin)} failed: ${(result.stderr || result.stdout || '').slice(-1400)}`);
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
Style: Caption,DejaVu Sans,44,&H00FFFFFF,&H00FFFFFF,&H00101010,&H8C000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,250,1
Style: Brand,DejaVu Sans,26,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,28,28,42,1
Style: Loc,DejaVu Sans,22,&H00E8F0FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,36,36,70,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
Dialogue: 0,0:00:00.00,${stamp(duration)},Loc,,0,0,0,,Magic Kingdom
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
    voice_settings: { stability: 0.4, similarity_boost: 0.72, style: 0.5, use_speaker_boost: true },
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

  const host = path.join(REFS, STORY.host);
  for (const f of [...STORY.stills, STORY.host]) {
    if (!fs.existsSync(path.join(REFS, f))) throw new Error(`Missing ${f}`);
  }

  // Reuse prior LL narration if present to save characters.
  const voiceMp3 = path.join(TMP, 'voice.mp3');
  const priorVoice = '/tmp/fb-ll-worth-it/ll.mp3';
  if (fs.existsSync(priorVoice) && process.env.REUSE_VOICE !== 'false') {
    fs.copyFileSync(priorVoice, voiceMp3);
    console.log('Reusing prior Lightning Lane VO…');
  } else {
    console.log('Synthesizing VO…');
    await elevenTts({ apiKey, text: STORY.spoken, outputPath: voiceMp3 });
  }

  const duration = Math.min(Math.max(audioDuration(voiceMp3) + 0.25, 16), 24);
  const assPath = path.join(TMP, 'captions.ass');
  const captions = STORY.captions.map((c, i, arr) => (i === arr.length - 1 ? { ...c, end: duration - 0.1 } : c));
  writeAss(captions, duration, assPath);

  const fps = 30;
  const totalFrames = Math.round(duration * fps);
  const framesA = Math.floor(totalFrames * 0.55);
  const framesB = totalFrames - framesA;
  const clipA = path.join(TMP, 'a.mp4');
  const clipB = path.join(TMP, 'b.mp4');
  const concatList = path.join(TMP, 'c.txt');
  const videoOnly = path.join(TMP, 'bg.mp4');
  const withHost = path.join(TMP, 'with-host.mp4');
  const master = path.join(OUT_DIR, 'host-overlay-ll-sample.mp4');

  function kenBurns(input, output, frames, zoomEnd) {
    run(ffmpegBin(), [
      '-y', '-loop', '1', '-i', input,
      '-vf', `scale=900:1600,zoompan=z='min(1+0.0012*on,${zoomEnd})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=${fps},format=yuv420p`,
      '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', output,
    ]);
  }

  console.log(`Building park background (${duration.toFixed(1)}s)…`);
  kenBurns(path.join(REFS, STORY.stills[0]), clipA, framesA, 1.12);
  kenBurns(path.join(REFS, STORY.stills[1]), clipB, framesB, 1.1);
  fs.writeFileSync(concatList, [`file '${clipA}'`, `file '${clipB}'`].join('\n'));
  run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', videoOnly]);

  // Host circle bottom-right, above captions; slight bob for life.
  console.log('Overlaying host…');
  run(ffmpegBin(), [
    '-y',
    '-i', videoOnly,
    '-i', host,
    '-filter_complex',
    [
      '[1:v]scale=220:220,format=rgba[host]',
      // Soft bob: ±6px vertical over ~2s
      `[0:v][host]overlay=x=720-220-36:y='1280-220-210+6*sin(2*PI*t/2)':format=auto[v]`,
    ].join(';'),
    '-map', '[v]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    withHost,
  ]);

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  run(ffmpegBin(), [
    '-y',
    '-i', withHost,
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

  fs.writeFileSync(path.join(OUT_DIR, 'host-overlay-ll-sample.md'), `# Host-overlay Lightning Lane sample

Same Disney worth-it story, with a **stock host circle** over Magic Kingdom stills.

- Not Gene on camera
- Host art: CC0 Unsplash portrait via Wikimedia (\`host-overlay.png\`)
- Park stills: Seven Dwarfs + Big Thunder Lightning Lane
`);

  console.log(JSON.stringify({
    ok: true,
    master,
    duration,
    host: 'stock-circle-overlay',
    geneOnCamera: false,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exitCode = 1; });
}
module.exports = { main, STORY };
