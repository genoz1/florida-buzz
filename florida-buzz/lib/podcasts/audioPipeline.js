'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { splitScriptIntoSections, formatScriptForTts } = require('./script');
const { isolateSpeech } = require('./elevenAudioClean');

/** Deterministic uneven join gaps (ms). Wider breath spacing between sections. */
const INTER_SECTION_GAP_MS = Object.freeze([140, 220, 160, 280, 180, 240, 150, 300, 190, 170]);

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-500)}`));
    });
  });
}

function interSectionGapMs(index) {
  return INTER_SECTION_GAP_MS[index % INTER_SECTION_GAP_MS.length];
}

/**
 * Trim only leading/trailing dead air from a fal section.
 * Gemini multi-speaker chunks often pad both ends with similar silence; leaving
 * that intact makes every section join feel beat-matched / metronomic.
 */
async function trimEdgeSilence(buffer, ffmpegPath) {
  if (!buffer?.length) throw new Error('Audio section is empty');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-trim-'));
  try {
    const inPath = path.join(dir, 'in.mp3');
    const outPath = path.join(dir, 'out.mp3');
    await fsp.writeFile(inPath, buffer);
    // Reverse-trim pattern: strip start silence, reverse, strip (former) end silence, reverse back.
    // Keep a short floor so natural breaths at edges are not clipped to zero.
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      inPath,
      '-af',
      [
        'silenceremove=start_periods=1:start_silence=0.08:start_threshold=-42dB:detection=peak',
        'areverse',
        'silenceremove=start_periods=1:start_silence=0.08:start_threshold=-42dB:detection=peak',
        'areverse',
      ].join(','),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '44100',
      outPath,
    ]);
    const trimmed = await fsp.readFile(outPath);
    // If trim somehow collapsed the file, keep the original section.
    return trimmed.length > 500 ? trimmed : buffer;
  } catch {
    return buffer;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function makeSilenceBuffer(ffmpegPath, durationMs) {
  const seconds = Math.max(0.02, Math.min(0.55, Number(durationMs) / 1000));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-silence-'));
  try {
    const outPath = path.join(dir, 'silence.mp3');
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=mono:sample_rate=44100',
      '-t',
      String(seconds),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      outPath,
    ]);
    return fsp.readFile(outPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Join fal TTS sections. Trim identical end-padding from each chunk and insert
 * short *varied* gaps so section seams do not lock to one metronomic pause.
 */
async function concatMp3Buffers(buffers, ffmpegPath, { varySectionGaps = true } = {}) {
  if (!buffers.length) throw new Error('No audio sections to join');
  if (buffers.length === 1) {
    return trimEdgeSilence(buffers[0], ffmpegPath);
  }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-'));
  try {
    const listPath = path.join(dir, 'list.txt');
    const outPath = path.join(dir, 'master.mp3');
    const parts = [];
    for (let i = 0; i < buffers.length; i += 1) {
      const trimmed = await trimEdgeSilence(buffers[i], ffmpegPath);
      const part = path.join(dir, `part-${i}.mp3`);
      await fsp.writeFile(part, trimmed);
      parts.push(part);
      if (varySectionGaps && i < buffers.length - 1) {
        const gapMs = interSectionGapMs(i);
        const silence = await makeSilenceBuffer(ffmpegPath, gapMs);
        const gapPath = path.join(dir, `gap-${i}.mp3`);
        await fsp.writeFile(gapPath, silence);
        parts.push(gapPath);
      }
    }
    await fsp.writeFile(listPath, parts.map((p) => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'));
    // Re-encode: trimmed parts + generated silence may not share identical MP3 framing.
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '44100',
      outPath,
    ]);
    return fsp.readFile(outPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Spoken throwaway used only to get Geno 2 past the distant cold-start.
 * Trimmed from the first TTS section before the real episode audio.
 * (~5s with current Geno 2 / eleven_v4 settings.)
 */
const VOICE_COLD_START_WARMUP =
  '[conversational] Okay… yeah. One two three. Alright.';

async function probeMp3DurationSec(buffer, ffmpegPath) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-probe-'));
  try {
    const inPath = path.join(dir, 'in.mp3');
    await fsp.writeFile(inPath, buffer);
    // Prefer system ffprobe; ffmpeg-static bundles often ship only the ffmpeg binary.
    const candidates = ['ffprobe', String(ffmpegPath || 'ffmpeg').replace(/ffmpeg$/, 'ffprobe')];
    for (const bin of candidates) {
      try {
        const dur = await new Promise((resolve, reject) => {
          const child = spawn(
            bin,
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inPath],
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
        return dur;
      } catch {
        /* try next / ffmpeg fallback */
      }
    }
    // Fallback: parse Duration from ffmpeg -i stderr (works with ffmpeg-static).
    const dur = await new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath || 'ffmpeg', ['-i', inPath], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    return dur;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Drop the leading N seconds (used to discard Geno 2 cold-start warmup). */
async function trimLeadingAudio(buffer, seconds, ffmpegPath) {
  const sec = Number(seconds);
  if (!buffer?.length) throw new Error('Audio buffer is empty');
  if (!Number.isFinite(sec) || sec <= 0.05) return buffer;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-trim-lead-'));
  try {
    const inPath = path.join(dir, 'in.mp3');
    const outPath = path.join(dir, 'out.mp3');
    await fsp.writeFile(inPath, buffer);
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-ss',
      sec.toFixed(3),
      '-i',
      inPath,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '44100',
      outPath,
    ]);
    const out = await fsp.readFile(outPath);
    return out.length > 500 ? out : buffer;
  } catch (err) {
    console.warn('[podcasts] leading trim skipped:', err.message);
    return buffer;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Warm leveling for Instant Geno / Geno 3 — body in the low-mids, cut tinny 3k.
 * Avoid presence boosts that read thin or metallic on PVC patches.
 */
async function applyVoicePresence(buffer, ffmpegPath) {
  if (!buffer?.length) throw new Error('Episode audio is empty');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-presence-'));
  try {
    const inPath = path.join(dir, 'in.mp3');
    const outPath = path.join(dir, 'out.mp3');
    await fsp.writeFile(inPath, buffer);
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      inPath,
      '-af',
      [
        'highpass=f=60',
        // Chest / warmth
        'equalizer=f=220:t=q:w=0.9:g=2',
        // Tinny upper-mid presence (Geno 3 runs hot here)
        'equalizer=f=3000:t=q:w=0.85:g=-3.5',
        // Soften harsh air without muffling consonants
        'equalizer=f=5500:t=q:w=0.7:g=-2.5',
        'acompressor=threshold=-22dB:ratio=2.4:attack=12:release=150:makeup=2',
        'loudnorm=I=-16:TP=-1.5:LRA=7',
      ].join(','),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '44100',
      outPath,
    ]);
    const out = await fsp.readFile(outPath);
    return out.length > 500 ? out : buffer;
  } catch (err) {
    console.warn('[podcasts] voice presence FX skipped:', err.message);
    return buffer;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Re-encode masters for storage. Long ~30–45 minute episodes at 192kbps exceed
 * Supabase Free global upload limit (50MB). Voice podcasts are fine at 96k mono.
 */
async function encodePodcastMaster(buffer, ffmpegPath, { bitrate = '96k', channels = 1 } = {}) {
  if (!buffer?.length) throw new Error('Episode audio is empty');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-encode-'));
  try {
    const inPath = path.join(dir, 'in.mp3');
    const outPath = path.join(dir, 'out.mp3');
    await fsp.writeFile(inPath, buffer);
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      inPath,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      bitrate,
      '-ac',
      String(channels),
      '-ar',
      '44100',
      outPath,
    ]);
    return fsp.readFile(outPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Re-encode concat so intro + fal TTS sections can have different encodings. */
async function prependAudioBuffer(introBuffer, bodyBuffer, ffmpegPath) {
  if (!introBuffer?.length) return bodyBuffer;
  if (!bodyBuffer?.length) throw new Error('Episode body audio is empty');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-intro-'));
  try {
    const introPath = path.join(dir, 'intro.mp3');
    const bodyPath = path.join(dir, 'body.mp3');
    const outPath = path.join(dir, 'with-intro.mp3');
    await fsp.writeFile(introPath, introBuffer);
    await fsp.writeFile(bodyPath, bodyBuffer);
    await runFfmpeg(ffmpegPath, [
      '-y',
      '-i',
      introPath,
      '-i',
      bodyPath,
      '-filter_complex',
      '[0:a][1:a]concat=n=2:v=0:a=1[a]',
      '-map',
      '[a]',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ac',
      '1',
      '-ar',
      '44100',
      outPath,
    ]);
    return fsp.readFile(outPath);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function loadIntroBuffer({ show, cfg, fetcher = fetch }) {
  const localPath = process.env.PODCASTS_INTRO_FILE;
  if (localPath) {
    return fsp.readFile(localPath);
  }
  const url = String(show?.intro_audio_url || '').trim();
  if (!url) return null;
  if (url.startsWith('/') && cfg?.site) {
    const absolute = `${String(cfg.site).replace(/\/$/, '')}${url}`;
    const res = await fetcher(absolute, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Failed to download show intro (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error('Show intro_audio_url must be https or a site-relative path');
  }
  const res = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Failed to download show intro (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('Show intro audio download was empty');
  return buffer;
}

function createAudioPipeline({ cfg, store, fal, eleven, ffmpegPath }) {
  async function persistMaster(episode, buffer, meta = {}) {
    const maxBytes = Number(process.env.PODCASTS_MAX_AUDIO_UPLOAD_BYTES || 48 * 1024 * 1024);
    if (buffer.length > maxBytes) {
      throw new Error(
        `Master audio is too large to upload (${Math.round(buffer.length / (1024 * 1024))}MB). ` +
          `Raise Supabase Storage global file size limit above 50MB, or keep episodes shorter. ` +
          `Original error risk: object exceeded maximum allowed size.`
      );
    }
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const storagePath = `${episode.show_id}/${episode.id}/master-${checksum.slice(0, 12)}.mp3`;
    let publicUrl = `memory://${storagePath}`;
    if (typeof store.uploadBytes === 'function') {
      try {
        publicUrl = await store.uploadBytes(cfg.audioBucket, storagePath, buffer, 'audio/mpeg');
      } catch (err) {
        const msg = String(err.message || err);
        if (/maximum allowed size|413|Payload too large/i.test(msg)) {
          throw new Error(
            `Supabase Storage rejected the master MP3 (${Math.round(buffer.length / (1024 * 1024))}MB): ${msg}. ` +
              `In Supabase → Storage → Settings, raise Global file size limit (Free max is 50MB). ` +
              `Also set podcast-audio bucket limit to 50MB. Then Reset stuck audio and Generate preview again.`
          );
        }
        throw err;
      }
    }
    const asset = await store.createAsset({
      kind: 'audio',
      storage_path: storagePath,
      public_url: publicUrl,
      content_type: 'audio/mpeg',
      byte_size: buffer.length,
      duration_seconds: meta.duration_seconds || null,
      checksum,
    });
    await store.updateEpisode(episode.id, {
      audio_asset_id: asset.id,
      audio_url: publicUrl,
      audio_byte_size: buffer.length,
      audio_content_type: 'audio/mpeg',
      duration_seconds: meta.duration_seconds || episode.duration_seconds || null,
      last_error: null,
    });
    return { asset, publicUrl, buffer };
  }

  async function generatePreviewEleven(episode, scriptText, sections, job) {
    if (!eleven) throw new Error('ElevenLabs TTS client is not configured');
    if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY missing');
    const buffers = [];
    let jobResult = {
      ...(job.result || {}),
      tts_provider: 'elevenlabs',
      eleven_model: cfg.elevenModel,
      eleven_voice: cfg.elevenVoiceGeno,
    };
    const sectionRetries =
      Number.isFinite(cfg.elevenSectionRetries) && cfg.elevenSectionRetries > 0 ? cfg.elevenSectionRetries : 2;

    for (let i = 0; i < sections.length; i += 1) {
      let buffer = null;
      let lastSectionError = null;
      const prevPlain = i > 0 ? formatScriptForTts(sections[i - 1], { keepSpeakerPrefix: false }) : null;
      const nextPlain =
        i < sections.length - 1 ? formatScriptForTts(sections[i + 1], { keepSpeakerPrefix: false }) : null;
      const useWarmup =
        i === 0 && cfg.voiceWarmupEnabled !== false && typeof eleven.synthesizeText === 'function';
      for (let attempt = 1; attempt <= sectionRetries && !buffer; attempt += 1) {
        jobResult = {
          ...jobResult,
          heartbeat_at: new Date().toISOString(),
          phase: 'synthesize',
          section: i + 1,
          section_attempt: attempt,
          voice_warmup: useWarmup,
        };
        await store.updateJob(job.id, { section_index: i, status: 'running', result: jobResult });
        try {
          if (useWarmup) {
            // Speak a throwaway line first so Geno 2 is past the distant cold-start,
            // then keep only the real section audio.
            const warmup = await eleven.synthesizeText(VOICE_COLD_START_WARMUP, {
              nextText: formatScriptForTts(sections[i], { keepSpeakerPrefix: false }),
            });
            const warmupSec = await probeMp3DurationSec(warmup.buffer, ffmpegPath);
            const sectionPlain = formatScriptForTts(sections[i], { keepSpeakerPrefix: false });
            const combined = await eleven.synthesizeText(`${VOICE_COLD_START_WARMUP}\n\n${sectionPlain}`, {
              previousText: VOICE_COLD_START_WARMUP,
              nextText: nextPlain,
            });
            buffer = await trimLeadingAudio(combined.buffer, warmupSec, ffmpegPath);
            jobResult = {
              ...jobResult,
              [`section_${i}_request`]: combined.requestId,
              [`section_${i}_attempt_${attempt}`]: combined.requestId,
              [`section_${i}_speed`]: combined.speed,
              voice_warmup_sec: warmupSec,
              heartbeat_at: new Date().toISOString(),
              phase: 'download',
              section: i + 1,
            };
          } else {
            const synthesized = await eleven.synthesize(sections[i], {
              previousText: prevPlain,
              nextText: nextPlain,
            });
            buffer = synthesized.buffer;
            jobResult = {
              ...jobResult,
              [`section_${i}_request`]: synthesized.requestId,
              [`section_${i}_attempt_${attempt}`]: synthesized.requestId,
              [`section_${i}_speed`]: synthesized.speed,
              heartbeat_at: new Date().toISOString(),
              phase: 'download',
              section: i + 1,
            };
          }
          await store.updateJob(job.id, { fal_request_id: jobResult[`section_${i}_request`], result: jobResult });
        } catch (err) {
          lastSectionError = err;
          console.warn(`[podcasts] elevenlabs section ${i + 1} attempt ${attempt}:`, err.message);
        }
      }
      if (!buffer) throw lastSectionError || new Error(`ElevenLabs section ${i + 1} failed`);
      buffers.push(buffer);
    }
    return { buffers, jobResult };
  }

  async function generatePreviewFal(episode, scriptText, sections, job) {
    if (!fal) throw new Error('fal TTS client is not configured');
    if (!cfg.falKey) throw new Error('FAL_KEY missing');
    const buffers = [];
    let jobResult = {
      ...(job.result || {}),
      tts_provider: 'fal',
      fal_endpoint: cfg.falEndpoint,
      fal_model: cfg.falModel,
    };
    const pollAttempts =
      Number.isFinite(cfg.falPollAttempts) && cfg.falPollAttempts > 0 ? cfg.falPollAttempts : 180;
    const pollIntervalMs =
      Number.isFinite(cfg.falPollIntervalMs) && cfg.falPollIntervalMs > 0 ? cfg.falPollIntervalMs : 2000;
    const sectionRetries =
      Number.isFinite(cfg.falSectionRetries) && cfg.falSectionRetries > 0 ? cfg.falSectionRetries : 2;

    for (let i = 0; i < sections.length; i += 1) {
      const prompt = formatScriptForTts(sections[i], { keepSpeakerPrefix: false });
      let audioUrl = null;
      let lastSectionError = null;

      for (let attempt = 1; attempt <= sectionRetries && !audioUrl; attempt += 1) {
        jobResult = {
          ...jobResult,
          heartbeat_at: new Date().toISOString(),
          phase: 'submit',
          section: i + 1,
          section_attempt: attempt,
        };
        await store.updateJob(job.id, { section_index: i, status: 'running', result: jobResult });

        let submitted;
        try {
          submitted = await fal.submit(prompt);
        } catch (err) {
          lastSectionError = err;
          console.warn(`[podcasts] fal submit failed section ${i + 1} attempt ${attempt}:`, err.message);
          continue;
        }

        jobResult = {
          ...jobResult,
          [`section_${i}_request`]: submitted.request_id,
          [`section_${i}_attempt_${attempt}`]: submitted.request_id,
          heartbeat_at: new Date().toISOString(),
          phase: 'poll',
          section: i + 1,
          section_attempt: attempt,
        };
        await store.updateJob(job.id, {
          fal_request_id: submitted.request_id,
          result: jobResult,
        });

        for (let poll = 0; poll < pollAttempts; poll += 1) {
          const status = await fal.status(submitted);
          jobResult = {
            ...jobResult,
            heartbeat_at: new Date().toISOString(),
            fal_status: status.status,
            poll,
            phase: 'poll',
            section: i + 1,
            section_attempt: attempt,
          };
          await store.updateJob(job.id, { status: 'running', section_index: i, result: jobResult });
          if (status.status === 'COMPLETED' || status.status === 'OK') {
            const result = await fal.result(submitted);
            audioUrl = result?.audio?.url || result?.data?.audio?.url;
            break;
          }
          if (status.status === 'FAILED' || status.status === 'ERROR') {
            lastSectionError = new Error(`fal section ${i + 1} failed`);
            break;
          }
          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }
        if (!audioUrl && !lastSectionError) {
          lastSectionError = new Error(
            `fal section ${i + 1} timed out after ${(pollAttempts * pollIntervalMs) / 1000}s`
          );
        }
        if (!audioUrl && attempt < sectionRetries) {
          console.warn(
            `[podcasts] retrying fal section ${i + 1} (attempt ${attempt + 1}/${sectionRetries}):`,
            lastSectionError?.message
          );
        }
      }

      if (!audioUrl) {
        throw lastSectionError || new Error(`fal section ${i + 1} timed out`);
      }
      jobResult = {
        ...jobResult,
        heartbeat_at: new Date().toISOString(),
        phase: 'download',
        section: i + 1,
      };
      await store.updateJob(job.id, { result: jobResult });
      buffers.push(await fal.downloadAudio(audioUrl));
    }
    return { buffers, jobResult };
  }

  async function generatePreview(episode, scriptText) {
    if (!cfg.generation) {
      throw new Error('PODCASTS_GENERATION_ENABLED is false — refusing paid TTS call');
    }
    if (!scriptText) throw new Error('Script is required before audio generation');
    const provider = cfg.ttsProvider || 'elevenlabs';
    if (provider === 'elevenlabs' && !cfg.elevenApiKey) {
      throw new Error('ELEVENLABS_API_KEY missing (set PODCASTS_TTS_PROVIDER=fal only if using fal fallback)');
    }
    if (provider === 'fal' && !cfg.falKey) throw new Error('FAL_KEY missing');

    await store.setStatus(episode.id, 'generating_audio');
    const sections = splitScriptIntoSections(scriptText, cfg.sectionMaxChars);
    const job = await store.createJob(episode.id, {
      status: 'running',
      section_count: sections.length,
      fal_endpoint: provider === 'fal' ? cfg.falEndpoint : null,
      fal_model: provider === 'fal' ? cfg.falModel : cfg.elevenModel,
    });

    try {
      const { buffers, jobResult: initialResult } =
        provider === 'fal'
          ? await generatePreviewFal(episode, scriptText, sections, job)
          : await generatePreviewEleven(episode, scriptText, sections, job);
      let jobResult = initialResult;

      let master = await concatMp3Buffers(buffers, ffmpegPath);
      let introAttached = false;
      let presenceApplied = false;
      jobResult = {
        ...jobResult,
        heartbeat_at: new Date().toISOString(),
        phase: 'assemble',
        section: sections.length,
      };
      await store.updateJob(job.id, { result: jobResult, section_index: sections.length - 1 });
      // Presence FX on TTS body only (before bumper) — pulls PVC “distant” dips forward.
      if (provider === 'elevenlabs' && cfg.voicePresenceFx !== false) {
        jobResult = {
          ...jobResult,
          heartbeat_at: new Date().toISOString(),
          phase: 'presence',
        };
        await store.updateJob(job.id, { result: jobResult });
        master = await applyVoicePresence(master, ffmpegPath);
        presenceApplied = true;
      }
      try {
        const show =
          (typeof store.getShowById === 'function' && episode.show_id
            ? await store.getShowById(episode.show_id)
            : null) ||
          (typeof store.getShow === 'function' ? await store.getShow(require('./config').DISNEY_SHOW_SLUG) : null);
        const intro = await loadIntroBuffer({ show, cfg });
        if (intro?.length) {
          master = await prependAudioBuffer(intro, master, ffmpegPath);
          introAttached = true;
        } else if (!presenceApplied) {
          master = await encodePodcastMaster(master, ffmpegPath);
        }
      } catch (introErr) {
        console.warn('[podcasts] intro prepend skipped:', introErr.message);
        if (!presenceApplied) {
          master = await encodePodcastMaster(master, ffmpegPath);
        }
      }
      jobResult = {
        ...jobResult,
        heartbeat_at: new Date().toISOString(),
        phase: 'upload',
        master_bytes: master.length,
        intro_attached: introAttached,
        presence_fx: presenceApplied,
      };
      await store.updateJob(job.id, { result: jobResult });
      const saved = await persistMaster(episode, master);
      await store.updateJob(job.id, {
        status: 'complete',
        section_index: sections.length - 1,
        result: {
          ...jobResult,
          sections: sections.length,
          asset_id: saved.asset.id,
          intro_attached: introAttached,
          master_bytes: saved.buffer.length,
        },
      });
      await store.setStatus(episode.id, 'preview_ready');
      return saved;
    } catch (err) {
      await store.updateJob(job.id, { status: 'failed', error_detail: err.message });
      await store.updateEpisode(episode.id, { status: 'failed', last_error: err.message });
      throw err;
    }
  }

  async function attachUploadedAudio(episode, fileBuffer, originalName = 'upload.mp3') {
    const saved = await persistMaster(episode, fileBuffer, {});
    const next = episode.status === 'draft' || episode.status === 'script_ready' || episode.status === 'failed'
      ? 'preview_ready'
      : episode.status === 'generating_audio'
        ? 'preview_ready'
        : episode.status;
    if (next !== episode.status) {
      try {
        await store.setStatus(episode.id, next);
      } catch {
        await store.updateEpisode(episode.id, { status: 'preview_ready' });
      }
    }
    return saved;
  }

  /**
   * Upload a human Geno take: ElevenLabs voice isolation (noise cleanup) →
   * encode → optional announcer intro prepend → store as private preview.
   * Keeps the real voice; does not clone or replace it.
   */
  async function attachCleanedRecording(episode, fileBuffer, originalName = 'recording.m4a', {
    prependIntro = true,
    isolateFn = isolateSpeech,
  } = {}) {
    if (!cfg.elevenApiKey) {
      throw new Error('ELEVENLABS_API_KEY is required to clean human recordings');
    }
    const raw = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || []);
    if (!raw.length) throw new Error('Recording is empty');

    await store.updateEpisode(episode.id, { last_error: null }).catch(() => {});
    try {
      await store.setStatus(episode.id, 'generating_audio');
    } catch {
      await store.updateEpisode(episode.id, { status: 'generating_audio' });
    }

    let cleaned;
    try {
      const isolated = await isolateFn(raw, {
        apiKey: cfg.elevenApiKey,
        filename: originalName || 'recording.m4a',
      });
      cleaned = isolated.buffer;
    } catch (err) {
      await store.updateEpisode(episode.id, {
        status: episode.status || 'script_ready',
        last_error: err.message,
      });
      throw err;
    }

    let master = await encodePodcastMaster(cleaned, ffmpegPath);
    let introAttached = false;
    if (prependIntro) {
      try {
        const show =
          (typeof store.getShowById === 'function' && episode.show_id
            ? await store.getShowById(episode.show_id)
            : null) ||
          (typeof store.getShow === 'function' ? await store.getShow(require('./config').DISNEY_SHOW_SLUG) : null);
        const intro = await loadIntroBuffer({ show, cfg });
        if (intro?.length) {
          master = await prependAudioBuffer(intro, master, ffmpegPath);
          introAttached = true;
        }
      } catch (introErr) {
        console.warn('[podcasts] intro prepend skipped on cleaned recording:', introErr.message);
      }
    }

    const saved = await persistMaster(episode, master, {});
    try {
      await store.setStatus(episode.id, 'preview_ready');
    } catch {
      await store.updateEpisode(episode.id, { status: 'preview_ready' });
    }
    await store
      .updateEpisode(episode.id, {
        last_error: null,
      })
      .catch(() => {});
    return { ...saved, cleaned: true, introAttached };
  }

  return {
    generatePreview,
    attachUploadedAudio,
    attachCleanedRecording,
    persistMaster,
    concatMp3Buffers,
    prependAudioBuffer,
    encodePodcastMaster,
  };
}

module.exports = {
  createAudioPipeline,
  concatMp3Buffers,
  trimEdgeSilence,
  makeSilenceBuffer,
  interSectionGapMs,
  INTER_SECTION_GAP_MS,
  prependAudioBuffer,
  encodePodcastMaster,
  applyVoicePresence,
  trimLeadingAudio,
  probeMp3DurationSec,
  VOICE_COLD_START_WARMUP,
  loadIntroBuffer,
};
