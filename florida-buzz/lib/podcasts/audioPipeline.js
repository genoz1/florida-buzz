'use strict';

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { splitScriptIntoSections, formatScriptForTts } = require('./script');

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

async function concatMp3Buffers(buffers, ffmpegPath) {
  if (!buffers.length) throw new Error('No audio sections to join');
  if (buffers.length === 1) return buffers[0];
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fb-podcast-'));
  try {
    const listPath = path.join(dir, 'list.txt');
    const outPath = path.join(dir, 'master.mp3');
    const parts = [];
    for (let i = 0; i < buffers.length; i += 1) {
      const part = path.join(dir, `part-${i}.mp3`);
      await fsp.writeFile(part, buffers[i]);
      parts.push(part);
    }
    await fsp.writeFile(listPath, parts.map((p) => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'));
    await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
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
      '192k',
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

function createAudioPipeline({ cfg, store, fal, ffmpegPath }) {
  async function persistMaster(episode, buffer, meta = {}) {
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const storagePath = `${episode.show_id}/${episode.id}/master-${checksum.slice(0, 12)}.mp3`;
    let publicUrl = `memory://${storagePath}`;
    if (typeof store.uploadBytes === 'function') {
      publicUrl = await store.uploadBytes(cfg.audioBucket, storagePath, buffer, 'audio/mpeg');
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

  async function generatePreview(episode, scriptText) {
    if (!cfg.generation) {
      throw new Error('PODCASTS_GENERATION_ENABLED is false — refusing paid fal TTS call');
    }
    if (!cfg.falKey) throw new Error('FAL_KEY missing');
    if (!scriptText) throw new Error('Script is required before audio generation');

    await store.setStatus(episode.id, 'generating_audio');
    const sections = splitScriptIntoSections(scriptText, cfg.sectionMaxChars);
    const job = await store.createJob(episode.id, {
      status: 'running',
      section_count: sections.length,
      fal_endpoint: cfg.falEndpoint,
      fal_model: cfg.falModel,
    });

    try {
      const buffers = [];
      for (let i = 0; i < sections.length; i += 1) {
        await store.updateJob(job.id, { section_index: i, status: 'running' });
        const prompt = formatScriptForTts(sections[i]);
        const submitted = await fal.submit(prompt);
        await store.updateJob(job.id, {
          fal_request_id: submitted.request_id,
          result: { ...(job.result || {}), [`section_${i}_request`]: submitted.request_id },
        });

        let audioUrl = null;
        for (let poll = 0; poll < 90; poll += 1) {
          const status = await fal.status(submitted);
          if (status.status === 'COMPLETED' || status.status === 'OK') {
            const result = await fal.result(submitted);
            audioUrl = result?.audio?.url || result?.data?.audio?.url;
            break;
          }
          if (status.status === 'FAILED' || status.status === 'ERROR') {
            throw new Error(`fal section ${i + 1} failed`);
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (!audioUrl) throw new Error(`fal section ${i + 1} timed out`);
        // Never publish temporary fal URLs — download and re-host.
        buffers.push(await fal.downloadAudio(audioUrl));
      }

      let master = await concatMp3Buffers(buffers, ffmpegPath);
      let introAttached = false;
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
        console.warn('[podcasts] intro prepend skipped:', introErr.message);
      }
      const saved = await persistMaster(episode, master);
      await store.updateJob(job.id, {
        status: 'complete',
        section_index: sections.length - 1,
        result: { sections: sections.length, asset_id: saved.asset.id, intro_attached: introAttached },
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

  return { generatePreview, attachUploadedAudio, persistMaster, concatMp3Buffers, prependAudioBuffer };
}

module.exports = {
  createAudioPipeline,
  concatMp3Buffers,
  prependAudioBuffer,
  loadIntroBuffer,
};
