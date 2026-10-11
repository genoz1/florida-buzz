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
}) {
  const fs = require('node:fs');
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,48,&H00FFFFFF,&H00FFFFFF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,36,36,210,1
Style: Brand,DejaVu Sans,24,&H00F4F7FF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,2,0,8,24,24,36,1
Style: Loc,DejaVu Sans,22,&H00E8F0FF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,2,0,2,32,32,64,1
Style: Badge,DejaVu Sans,20,&H0000D7FF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,2,0,7,24,24,36,1
Style: Cta,DejaVu Sans,36,&H00FFFFFF,&H00FFFFFF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,280,1

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

function muxAssAndAudio({ videoPath, audioPath, assPath, outputPath }) {
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
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
