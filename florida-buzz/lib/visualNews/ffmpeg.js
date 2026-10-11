'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

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
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(String(bin))} failed: ${(result.stderr || result.stdout || '').slice(-1400)}`
    );
  }
  return result.stdout;
}

function audioDuration(file) {
  const n = Number(
    run(ffprobeBin(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ]).trim()
  );
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid audio duration');
  return n;
}

function stamp(seconds) {
  const c = Math.round(seconds * 100);
  return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, '0')}:${String(
    Math.floor(c / 100) % 60
  ).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/[{}\\\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Kinetic ASS captions: brand + location + timed lines with fade/pop + optional yellow highlights.
 * Mobile-first: large bold caption type for 9:16 social.
 * highlight: substring to wrap in yellow ASS color tags.
 */
function writeAss({
  captions,
  duration,
  outPath,
  brand = 'THE FLORIDA BUZZ',
  location = '',
  width = 720,
  height = 1280,
  ctaEndText = 'Follow Florida Buzz',
  accents = [],
}) {
  const fs = require('node:fs');
  // Caption Fontsize 78 (~62% larger than prior 48) — readable on phone without zooming.
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,78,&H00FFFFFF,&H00FFFFFF,&H00101010,&HAA000000,-1,0,0,0,100,100,0,0,1,5,2,2,28,28,240,1
Style: Brand,DejaVu Sans,34,&H00F4F7FF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,8,20,20,28,1
Style: Loc,DejaVu Sans,30,&H00E8F0FF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,2,28,28,52,1
Style: Badge,DejaVu Sans,28,&H0000D7FF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,7,20,20,28,1
Style: Cta,DejaVu Sans,52,&H00FFFFFF,&H00FFFFFF,&H00101010,&HAA000000,-1,0,0,0,100,100,0,0,1,5,2,2,32,32,300,1
Style: MoneyAccent,DejaVu Sans,64,&H0000FF5A,&H00FFFFFF,&H00101010,&HBB000000,-1,0,0,0,100,100,0,0,1,4,2,8,28,28,160,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,${escapeAssText(brand)}
Dialogue: 0,0:00:00.00,${stamp(Math.min(3.2, duration))},Badge,,0,0,0,,{\\fad(120,80)}FLORIDA NEWS
`;
  if (location) {
    ass += `Dialogue: 0,0:00:00.00,${stamp(duration)},Loc,,0,0,0,,${escapeAssText(location)}\n`;
  }

  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    let text = escapeAssText(c.text);
    if (c.highlight) {
      const h = escapeAssText(c.highlight);
      if (h && text.includes(h)) {
        text = text.replace(h, `{\\c&H00FFFF&}${h}{\\c&HFFFFFF&}`);
      }
    }
    // Fade + slight scale pop for kinetic feel
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,{\\fad(90,70)\\t(0,160,\\fscx108\\fscy108)\\t(160,280,\\fscx100\\fscy100)}${text}\n`;
  }

  for (const a of accents || []) {
    const end = Math.min(a.end, duration - 0.05);
    if (end <= a.start) continue;
    const style = a.style || 'MoneyAccent';
    ass += `Dialogue: 3,${stamp(a.start)},${stamp(end)},${style},,0,0,0,,{\\fad(100,80)}${escapeAssText(a.text)}\n`;
  }

  const ctaStart = Math.max(0, duration - 3.2);
  if (ctaEndText && ctaStart < duration) {
    ass += `Dialogue: 2,${stamp(ctaStart)},${stamp(duration)},Cta,,0,0,0,,{\\fad(160,0)}${escapeAssText(ctaEndText)}\n`;
  }

  fs.writeFileSync(outPath, ass);
}

function kenBurnsClip({
  input,
  output,
  frames,
  zoomEnd = 1.12,
  width = 720,
  height = 1280,
  fps = 30,
  pan = 'center',
}) {
  const scaleW = Math.round(width * 1.25);
  const scaleH = Math.round(height * 1.25);
  let xExpr = 'iw/2-(iw/zoom/2)';
  let yExpr = 'ih/2-(ih/zoom/2)';
  if (pan === 'left') xExpr = `iw/2-(iw/zoom/2)-0.08*iw*(on/${frames})`;
  if (pan === 'right') xExpr = `iw/2-(iw/zoom/2)+0.08*iw*(on/${frames})`;
  if (pan === 'up') yExpr = `ih/2-(ih/zoom/2)-0.06*ih*(on/${frames})`;
  if (pan === 'down') yExpr = `ih/2-(ih/zoom/2)+0.06*ih*(on/${frames})`;

  run(ffmpegBin(), [
    '-y',
    '-loop',
    '1',
    '-i',
    input,
    '-vf',
    `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH},zoompan=z='min(1+0.00115*on,${zoomEnd})':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${fps},format=yuv420p`,
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    output,
  ]);
}

function concatVideos(listPath, output) {
  run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', output]);
}

/**
 * Mux audio + ASS captions, optionally compositing timed PNG overlays (money/wallet accents).
 * overlays: [{ path, start, end, x, y }]
 */
function muxAssAndAudio({ videoPath, audioPath, assPath, outputPath, overlays = [] }) {
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  // When no overlays, keep the simpler -vf path (avoids filter_complex map quirks).
  if (!overlays.length) {
    run(ffmpegBin(), [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-vf',
      `ass=${assEscaped},format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    return;
  }

  const args = ['-y', '-i', videoPath, '-i', audioPath];
  for (const ov of overlays) {
    args.push('-loop', '1', '-i', ov.path);
  }

  const parts = [];
  let last = '[0:v]';
  overlays.forEach((ov, i) => {
    const inputIdx = i + 2; // 0=video, 1=audio, overlays start at 2
    const out = i === overlays.length - 1 ? '[vbase]' : `[v${i}]`;
    const x = ov.x || '(W-w)/2';
    const y = ov.y || '240';
    parts.push(
      `${last}[${inputIdx}:v]overlay=x=${x}:y=${y}:enable='between(t,${ov.start},${ov.end})':format=auto${out}`
    );
    last = out;
  });
  parts.push(`[vbase]ass=${assEscaped},format=yuv420p[vout]`);

  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath
  );
  run(ffmpegBin(), args);
}

module.exports = {
  ffmpegBin,
  ffprobeBin,
  run,
  audioDuration,
  stamp,
  escapeAssText,
  writeAss,
  kenBurnsClip,
  concatVideos,
  muxAssAndAudio,
};
