'use strict';

/**
 * Dual-host audio mixer: synthesize each line on its own voice, balance mic
 * distance per speaker, loudnorm to the same target, then lay tracks with
 * optional overlap (negative delay vs previous).
 *
 * Text-to-Dialogue alone cannot create true talk-over; this path can.
 */

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MSM_DELIVERY_TARGETS } = require('./deliveryMsm');

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-600)}`));
    });
  });
}

async function probeDurationSec(ffmpegPath, filePath) {
  const ffprobeBin = 'ffprobe';
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        ffprobeBin,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => {
        out += c.toString();
      });
      child.stderr.on('data', (c) => {
        err += c.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const n = Number(String(out).trim());
        if (code === 0 && Number.isFinite(n) && n > 0) resolve(n);
        else reject(new Error(`ffprobe duration failed: ${err || out}`));
      });
    });
  } catch {
    // ffmpeg-static path may not include ffprobe — parse ffmpeg -i
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath || 'ffmpeg', ['-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (c) => {
        err += c.toString();
      });
      child.on('error', reject);
      child.on('close', () => {
        const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
        if (!m) return reject(new Error('ffmpeg duration parse failed'));
        resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      });
    });
  }
}

/**
 * Per-speaker mic-distance balance, then identical loudnorm target.
 * Geno gets warm body + tinny 3k cut; premade cohosts (Amy) step back from lips-on-mic.
 */
function speakerBalanceFilter(speaker, { loudnessLufs = -16, truePeakDb = -1.5 } = {}) {
  const sp = String(speaker || '').toLowerCase();
  const loudnorm = `loudnorm=I=${loudnessLufs}:TP=${truePeakDb}:LRA=6`;
  if (sp === 'geno') {
    // Warm / close without metallic 3k presence boost
    return [
      'highpass=f=60',
      'equalizer=f=220:t=q:w=0.9:g=1.8',
      'equalizer=f=3000:t=q:w=0.85:g=-3',
      'equalizer=f=5500:t=q:w=0.7:g=-2',
      'acompressor=threshold=-22dB:ratio=2.4:attack=12:release=150:makeup=2.2',
      `loudnorm=I=${loudnessLufs}:TP=${truePeakDb}:LRA=6`,
    ].join(',');
  }
  // Gena / Amy / Eliza — step back from the mic (cut proximity + air)
  return [
    'highpass=f=85',
    'equalizer=f=160:t=q:w=1.0:g=-3',
    'equalizer=f=3200:t=q:w=0.85:g=-3.5',
    'equalizer=f=6500:t=q:w=0.7:g=-2.5',
    'acompressor=threshold=-20dB:ratio=2.2:attack=15:release=160:makeup=1.2',
    'volume=-1dB',
    loudnorm,
  ].join(',');
}

async function balanceAndLoudnormFile(
  ffmpegPath,
  inPath,
  outPath,
  { speaker, loudnessLufs = -16, truePeakDb = -1.5 } = {}
) {
  await runFfmpeg(ffmpegPath, [
    '-y',
    '-i',
    inPath,
    '-af',
    speakerBalanceFilter(speaker, { loudnessLufs, truePeakDb }),
    '-ar',
    '44100',
    '-ac',
    '1',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    outPath,
  ]);
}

/** @deprecated use balanceAndLoudnormFile — kept for callers/tests */
async function loudnormFile(ffmpegPath, inPath, outPath, { i = -16, tp = -1.5, lra = 11 } = {}) {
  await runFfmpeg(ffmpegPath, [
    '-y',
    '-i',
    inPath,
    '-af',
    `loudnorm=I=${i}:TP=${tp}:LRA=${lra}`,
    '-ar',
    '44100',
    '-ac',
    '1',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '128k',
    outPath,
  ]);
}

/**
 * @param {object} opts
 * @param {string} opts.ffmpegPath
 * @param {Array<{speaker:string,text:string,overlapPrevMs?:number,gapAfterMs?:number,buffer:Buffer}>} opts.lines
 * @param {string} [opts.outPath]
 */
async function mixDualLines({
  ffmpegPath = 'ffmpeg',
  lines,
  outPath,
  loudnessLufs = MSM_DELIVERY_TARGETS.loudnessLufs,
  truePeakDb = MSM_DELIVERY_TARGETS.truePeakDb,
  matchMicDistance = true,
} = {}) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('mixDualLines requires lines');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-dual-mix-'));
  const finalOut = outPath || path.join(dir, 'mix.mp3');
  try {
    const normPaths = [];
    const durations = [];
    for (let i = 0; i < lines.length; i++) {
      const rawPath = path.join(dir, `raw-${i}.mp3`);
      const normPath = path.join(dir, `norm-${i}.mp3`);
      await fsp.writeFile(rawPath, lines[i].buffer);
      if (matchMicDistance) {
        await balanceAndLoudnormFile(ffmpegPath, rawPath, normPath, {
          speaker: lines[i].speaker,
          loudnessLufs,
          truePeakDb,
        });
      } else {
        await loudnormFile(ffmpegPath, rawPath, normPath, {
          i: loudnessLufs,
          tp: truePeakDb,
          lra: 6,
        });
      }
      normPaths.push(normPath);
      durations.push(await probeDurationSec(ffmpegPath, normPath));
    }

    // Place each clip on a timeline: start = cursor - overlapPrev; then cursor = start + dur + gapAfter
    let cursorMs = 0;
    const placements = [];
    for (let i = 0; i < lines.length; i++) {
      const overlap = Math.max(0, Number(lines[i].overlapPrevMs) || 0);
      const startMs = i === 0 ? 0 : Math.max(0, cursorMs - overlap);
      const durMs = Math.round(durations[i] * 1000);
      const gapAfter = Math.max(0, Number(lines[i].gapAfterMs) || 0);
      placements.push({ startMs, durMs, path: normPaths[i], speaker: lines[i].speaker });
      cursorMs = startMs + durMs + gapAfter;
    }
    const totalMs = Math.max(...placements.map((p) => p.startMs + p.durMs)) + 200;
    const totalSec = (totalMs / 1000).toFixed(3);

    // Pad each input with adelay, then amix
    const args = ['-y'];
    for (const p of placements) {
      args.push('-i', p.path);
    }
    const filterParts = [];
    for (let i = 0; i < placements.length; i++) {
      const delay = placements[i].startMs;
      filterParts.push(
        `[${i}:a]adelay=${delay}|${delay},apad=whole_dur=${totalSec},aformat=sample_rates=44100:channel_layouts=mono[a${i}]`
      );
    }
    const mixInputs = placements.map((_, i) => `[a${i}]`).join('');
    // Final bus loudnorm only — per-line already matched; keep LRA a bit open
    filterParts.push(
      `${mixInputs}amix=inputs=${placements.length}:duration=longest:normalize=0,loudnorm=I=${loudnessLufs}:TP=${truePeakDb}:LRA=8[out]`
    );
    args.push(
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[out]',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      finalOut
    );
    await runFfmpeg(ffmpegPath, args);

    const buffer = await fsp.readFile(finalOut);
    return {
      buffer,
      outPath: finalOut,
      placements,
      totalMs,
      lineCount: lines.length,
      matchMicDistance: !!matchMicDistance,
    };
  } finally {
    if (!outPath) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    } else if (!String(outPath).startsWith(dir)) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  mixDualLines,
  loudnormFile,
  balanceAndLoudnormFile,
  speakerBalanceFilter,
  probeDurationSec,
  runFfmpeg,
};
