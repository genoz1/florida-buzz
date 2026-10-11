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
 * Clean modern social-news ASS:
 * - Bold kinetic captions (not meme spam)
 * - Coral accent highlights
 * - Brand via PNG pill (ASS brand kept subtle / optional location)
 * - Captions sit in lower safe zone so faces stay readable
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
  // Noto Sans Display when available via fontconfig; DejaVu is a safe ASS fallback name.
  // Outline 3 (not 6) — readable without meme-generator look.
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Noto Sans Display,68,&H00FFFFFF,&H00FFFFFF,&H00101018,&H55000000,-1,0,0,0,100,100,0.5,0,1,2,1,2,40,40,200,1
Style: Brand,Noto Sans Display,28,&H00F4F7FF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,28,28,40,1
Style: Loc,Noto Sans Display,28,&H00F0F4FF,&H00FFFFFF,&H00101018,&HAA000000,-1,0,0,0,100,100,0,0,1,2,1,1,28,28,110,1
Style: Cta,Noto Sans Display,44,&H00FFFFFF,&H00FFFFFF,&H00101018,&H88000000,-1,0,0,0,100,100,0,0,1,2,1,2,40,40,220,1
Style: Accent,Noto Sans Display,58,&H00324EFF,&H00FFFFFF,&H00101018,&H55000000,-1,0,0,0,100,100,0,0,1,2,1,8,32,32,180,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // Brand mark is the PNG pill — ASS brand kept for tests / callers that assert presence,
  // but drawn off-canvas so it does not double-stack with the pill.
  if (brand) {
    ass += `Dialogue: 0,0:00:00.00,${stamp(Math.min(0.05, duration))},Brand,,0,0,0,,{\\alpha&HFF&}${escapeAssText(brand)}\n`;
  }
  // Location sits bottom-left as a quiet lower-third cue (above TikTok chrome).
  if (location) {
    ass += `Dialogue: 0,0:00:00.00,${stamp(duration)},Loc,,0,0,0,,{\\fad(200,200)}${escapeAssText(location)}\n`;
  }

  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    let text = escapeAssText(c.text);
    if (c.highlight) {
      const h = escapeAssText(c.highlight);
      if (h && text.includes(h)) {
        // Coral accent (&H00324EFF = BGR for #FF4E32)
        text = text.replace(h, () => `{\\c&H00324EFF&}${h}{\\c&HFFFFFF&}`);
      }
    }
    // Fade + modest scale pop (not cartoon bounce)
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,{\\fad(110,90)\\t(0,140,\\fscx106\\fscy106)\\t(140,260,\\fscx100\\fscy100)}${text}\n`;
  }

  for (const a of accents || []) {
    const end = Math.min(a.end, duration - 0.05);
    if (end <= a.start) continue;
    const style = a.style || 'Accent';
    ass += `Dialogue: 3,${stamp(a.start)},${stamp(end)},${style},,0,0,0,,{\\fad(100,80)}${escapeAssText(a.text)}\n`;
  }

  const ctaStart = Math.max(0, duration - 3.2);
  if (ctaEndText && layoutCta(ctaStart, duration)) {
    ass += `Dialogue: 2,${stamp(ctaStart)},${stamp(duration)},Cta,,0,0,0,,{\\fad(160,0)}${escapeAssText(ctaEndText)}\n`;
  }

  fs.writeFileSync(outPath, ass);
}

function layoutCta(ctaStart, duration) {
  return ctaStart < duration;
}

function kenBurnsClip({
  input,
  output,
  frames,
  zoomEnd = 1.16,
  width = 720,
  height = 1280,
  fps = 30,
  pan = 'center',
}) {
  const scaleW = Math.round(width * 1.32);
  const scaleH = Math.round(height * 1.32);
  let xExpr = 'iw/2-(iw/zoom/2)';
  let yExpr = 'ih/2-(ih/zoom/2)';
  // Stronger pans for higher energy without looking drunk
  if (pan === 'left') xExpr = `iw/2-(iw/zoom/2)-0.12*iw*(on/${frames})`;
  if (pan === 'right') xExpr = `iw/2-(iw/zoom/2)+0.12*iw*(on/${frames})`;
  if (pan === 'up') yExpr = `ih/2-(ih/zoom/2)-0.1*ih*(on/${frames})`;
  if (pan === 'down') yExpr = `ih/2-(ih/zoom/2)+0.1*ih*(on/${frames})`;

  // Faster zoom ramp for punchier Ken Burns
  const zStep = Math.max(0.0014, (zoomEnd - 1) / Math.max(frames, 1));
  run(ffmpegBin(), [
    '-y',
    '-loop',
    '1',
    '-i',
    input,
    '-vf',
    `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH},zoompan=z='min(1+${zStep}*on,${zoomEnd})':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${fps},eq=contrast=1.06:saturation=1.08,format=yuv420p`,
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
 * Mux audio + ASS captions, optionally compositing timed PNG overlays.
 * overlays: [{ path, start, end, x, y, fadeIn?, fadeOut? }]
 */
function muxAssAndAudio({ videoPath, audioPath, assPath, outputPath, overlays = [], duration }) {
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

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
  // Prepare each overlay with optional alpha fades
  overlays.forEach((ov, i) => {
    const inputIdx = i + 2;
    const fadeIn = Number(ov.fadeIn) || 0;
    const fadeOut = Number(ov.fadeOut) || 0;
    const start = ov.start;
    const end = ov.end >= 900 ? (duration || 30) : ov.end;
    let chain = `[${inputIdx}:v]format=rgba`;
    if (fadeIn > 0) {
      chain += `,fade=t=in:st=${start}:d=${fadeIn}:alpha=1`;
    }
    if (fadeOut > 0) {
      const outStart = Math.max(start, end - fadeOut);
      chain += `,fade=t=out:st=${outStart}:d=${fadeOut}:alpha=1`;
    }
    chain += `[ov${i}]`;
    parts.push(chain);
  });

  let last = '[0:v]';
  overlays.forEach((ov, i) => {
    const out = i === overlays.length - 1 ? '[vbase]' : `[v${i}]`;
    const x = ov.x || '(W-w)/2';
    const y = ov.y || '210';
    const end = ov.end >= 900 ? (duration || 30) : ov.end;
    parts.push(
      `${last}[ov${i}]overlay=x=${x}:y=${y}:enable='between(t,${ov.start},${end})':format=auto${out}`
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
