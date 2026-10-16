'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { generateValidatedImageResult } = require('../imageGen');
const { probeMp3DurationSec } = require('./audioPipeline');
const { buildScenePlan, parseMarkedSegments } = require('./videoPlan');
const { broadenVisualPrompt } = require('./videoVisuals');
const { fitCoverFrame, renderAgendaCard, renderBrandCard, renderThumbnailFrame, renderTopicCard, renderTopicFrame } = require('./videoCards');
const { uploadThumbnail, uploadVideo, youtubeConfigured } = require('./youtubeClient');

/** Prefer a real probed MP3 length when episode.duration_seconds is missing or tiny. */
function resolveVideoTotalSeconds(episodeDurationSeconds, probedSeconds) {
  const stored = Number(episodeDurationSeconds);
  const probed = Number(probedSeconds);
  if (Number.isFinite(probed) && probed >= 30) {
    // Stored duration is often null after upload-only publishes; probe is source of truth.
    if (!Number.isFinite(stored) || stored < 30 || Math.abs(stored - probed) > 15) return probed;
    return stored;
  }
  if (Number.isFinite(stored) && stored >= 30) return stored;
  throw new Error(
    `Cannot build a YouTube video without a usable audio duration (stored=${episodeDurationSeconds}, probed=${probedSeconds})`
  );
}

const execFileAsync = promisify(execFile);

function safeSlug(value) {
  return String(value || 'visual').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'visual';
}

function stripHtml(value) {
  return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}

async function fetchBuffer(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Could not download ${url} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

function parseJsonObject(value) {
  let text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Topic planner returned no JSON object');
  text = text.slice(start, end + 1)
    // Common model slips that break JSON.parse
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
  try {
    return JSON.parse(text);
  } catch (firstError) {
    // Escape raw newlines inside string values (another common model slip).
    let inString = false;
    let escaped = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"' && text[i - 1] !== '\\') inString = !inString;
      if (inString && (ch === '\n' || ch === '\r')) {
        escaped += '\\n';
        continue;
      }
      escaped += ch;
    }
    try {
      return JSON.parse(escaped);
    } catch {
      throw firstError;
    }
  }
}

async function planTopicVisuals({ episode, aiText }) {
  const segments = parseMarkedSegments(episode.script_text || '');
  const storySegments = segments.filter((segment) => !/^(open|midroll|partner|close|outro)/.test(segment.slug));
  if (!storySegments.length || !aiText?.generateText) return [];
  // Keep evidence short so the model returns valid JSON under the token budget.
  const evidence = storySegments.map((segment) => ({ slug: segment.slug, transcript: segment.text.slice(0, 900) }));
  const system = `You plan accurate cinematic illustrated visuals for the Florida Buzz Disney World news podcast YouTube episode.
Return strict JSON only (no markdown): {"topics":[{"slug":"story-1","title":"short on-screen topic title","description":"max 6 words, under 38 characters","category":"stable-reusable-category","prompts":["prompt 1","prompt 2"]}]}.
Keep each description to at most 6 words and 38 characters so it fits one agenda-menu line. Use exactly two prompts per story. Each prompt is ONE sentence naming one real Walt Disney World place from that story, with dense detail and bright natural Florida daylight (no yellow cast). Style: richly detailed cinematic digital travel illustration. Never celebrities/named characters. Never mashups or invented attractions. No readable text. Escape all quotes inside strings. Use the transcript only as evidence.`;
  const user = JSON.stringify({ episodeTitle: episode.title, segments: evidence });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await aiText.generateText(system, user, attempt === 1 ? 2200 : 1600);
      const parsed = parseJsonObject(raw);
      const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
      if (!topics.length) throw new Error('Topic planner returned empty topics');
      return topics;
    } catch (err) {
      console.warn(`[podcasts] Topic visual planner attempt ${attempt} failed: ${err.message}`);
      if (attempt === 2) {
        console.warn('[podcasts] Continuing YouTube render with default story titles (planner JSON unusable)');
        return [];
      }
    }
  }
  return [];
}

function createVideoPipeline({ cfg, store, supabase, aiText, ffmpegPath }) {
  async function findAsset(storagePath) {
    if (!supabase) return null;
    const { data, error } = await supabase.from('podcast_assets').select('*').eq('storage_path', storagePath).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0] || null;
  }

  async function saveVisual(buffer, storagePath) {
    // Always upload bytes so a later accepted still can replace a prior candidate.
    const publicUrl = await store.uploadBytes(cfg.artworkBucket, storagePath, buffer, 'image/png');
    const existing = await findAsset(storagePath);
    if (existing?.public_url) return publicUrl || existing.public_url;
    await store.createAsset({
      kind: 'youtube_image',
      storage_path: storagePath,
      public_url: publicUrl,
      content_type: 'image/png',
      byte_size: buffer.length,
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    });
    return publicUrl;
  }

  async function tryGenerateTopicStill(prompt, scene, storagePath) {
    let captured = null;
    const { PODCAST_YOUTUBE_ILLUSTRATION_STYLE } = require('./videoVisuals');
    const { generateImage } = require('../openai');
    const result = await generateValidatedImageResult(
      prompt,
      { title: scene.label, slug: scene.visualKey, subject: scene.label, location: 'Walt Disney World Resort' },
      {
        styleRequirements: PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
        generate: (text) => generateImage(text, { quality: 'high' }),
        // Keep rejected candidates out of durable storage — only persist after accept.
        store: async (buffer) => {
          captured = buffer;
          return `memory://${storagePath}`;
        },
      }
    );
    if (result.status === 'accepted' && captured) {
      await saveVisual(captured, storagePath);
      return captured;
    }
    return { rejected: true, correction: result.correction || result.error || result.status };
  }

  async function topicImage(scene, { episode }) {
    // v2 = painterly podcast illustration style (do not reuse v1 photoreal stills).
    const storagePath = `youtube-visuals/v2/episodes/${safeSlug(episode.id)}/${safeSlug(scene.segmentSlug)}-${Number(scene.imageIndex) || 0}.png`;
    const existing = await findAsset(storagePath);
    if (existing?.public_url) {
      console.log(`[podcasts] Reusing YouTube still ${storagePath}`);
      return fetchBuffer(existing.public_url);
    }

    console.log(`[podcasts] Generating YouTube still ${storagePath} for ${scene.label}`);
    let lastCorrection = '';
    const first = await tryGenerateTopicStill(scene.prompt, scene, storagePath);
    if (Buffer.isBuffer(first)) return first;
    lastCorrection = first.correction || '';

    for (let level = 1; level <= 2; level += 1) {
      const broader = broadenVisualPrompt(scene.prompt, {
        label: scene.label,
        category: scene.category,
        level,
        rejection: lastCorrection,
      });
      console.warn(`[podcasts] Broadening YouTube visual for ${scene.label} (level ${level}) — still locked to this story`);
      const next = await tryGenerateTopicStill(broader, scene, storagePath);
      if (Buffer.isBuffer(next)) return next;
      lastCorrection = next.correction || lastCorrection;
    }

    // Last resort: story title card for THIS topic — never generic castle / cover art.
    console.warn(`[podcasts] Using story title card for ${scene.label}: ${lastCorrection || 'no approved visual'}`);
    return renderTopicCard({ label: scene.label, category: scene.category });
  }

  async function runFfmpeg(args) {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 8 * 1024 * 1024 });
  }

  async function renderVideo({ episode, show }) {
    if (!episode.audio_url) throw new Error('Episode has no permanent audio URL');
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'florida-buzz-youtube-'));
    try {
      const [audioBuffer, coverBuffer, topicMeta] = await Promise.all([
        fetchBuffer(episode.audio_url),
        fetchBuffer(episode.artwork_url || show.cover_url),
        planTopicVisuals({ episode, aiText }),
      ]);
      const audioPath = path.join(workDir, 'episode.mp3');
      await fs.promises.writeFile(audioPath, audioBuffer);
      const probedSeconds = await probeMp3DurationSec(audioBuffer, ffmpegPath);
      const totalSeconds = resolveVideoTotalSeconds(episode.duration_seconds, probedSeconds);
      if (!Number(episode.duration_seconds) || Math.abs(Number(episode.duration_seconds) - totalSeconds) > 1) {
        console.warn(
          `[podcasts] YouTube timing uses probed audio duration ${totalSeconds.toFixed(1)}s ` +
            `(episode.duration_seconds=${episode.duration_seconds == null ? 'null' : episode.duration_seconds})`
        );
        if (typeof store.updateEpisode === 'function') {
          await store.updateEpisode(episode.id, { duration_seconds: Math.round(totalSeconds) }).catch((err) => {
            console.warn(`[podcasts] Could not backfill duration_seconds for ${episode.id}: ${err.message}`);
          });
        }
      }
      const plan = buildScenePlan({
        scriptText: episode.script_text,
        totalSeconds,
        bumperSeconds: cfg.youtubeIntroSeconds,
        topicMeta,
        imagesPerTopic: cfg.youtubeImagesPerTopic,
        episodeId: episode.id,
      });
      const agendaFooter = episode.published_at
        ? `FLORIDA BUZZ: DISNEY - ${new Date(episode.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}`
        : 'FLORIDA BUZZ: DISNEY WORLD';
      const agendaBuffer = await renderAgendaCard({ coverBuffer, topics: plan.topics, footer: agendaFooter });
      const brandBuffer = await renderBrandCard({ coverBuffer, label: 'Florida Buzz Disney Podcast' });
      // Square podcast artwork must letterbox into 16:9 — never crop FLORIDA BUZZ off the top.
      const coverFrame = await fitCoverFrame(coverBuffer);
      const sceneClips = [];
      let thumbnailBuffer = null;
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        let imageBuffer;
        if (scene.kind === 'topic') {
          const still = await topicImage(scene, { episode });
          imageBuffer = await renderTopicFrame(still, {
            label: scene.label,
            category: scene.category,
            caption: scene.caption,
            aiLabel: false,
          });
          if (!thumbnailBuffer) {
            thumbnailBuffer = await renderThumbnailFrame(still, {
              label: scene.label,
              category: scene.category,
            });
          }
        } else if (scene.kind === 'agenda') {
          imageBuffer = agendaBuffer;
        } else if (scene.kind === 'brand') {
          imageBuffer = brandBuffer;
        } else {
          imageBuffer = coverFrame;
        }
        const imagePath = path.join(workDir, `scene-${String(i).padStart(3, '0')}.png`);
        const clipPath = path.join(workDir, `clip-${String(i).padStart(3, '0')}.mp4`);
        await fs.promises.writeFile(imagePath, imageBuffer);
        const duration = Math.max(0.8, Number(scene.durationSeconds) || 1);
        const fadeOut = Math.max(0, duration - 0.35).toFixed(3);
        // Frames are already 1920×1080. Keep stills stationary — no Ken Burns / zoompan.
        await runFfmpeg([
          '-loop', '1', '-i', imagePath,
          '-vf', `fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35`,
          '-t', duration.toFixed(3), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', clipPath,
        ]);
        sceneClips.push(clipPath);
      }
      const concatList = path.join(workDir, 'clips.txt');
      await fs.promises.writeFile(concatList, sceneClips.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'));
      const silentVideo = path.join(workDir, 'silent.mp4');
      await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', silentVideo]);
      const outputPath = path.join(workDir, 'florida-buzz-podcast.mp4');
      await runFfmpeg(['-i', silentVideo, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outputPath]);
      return { outputPath, workDir, plan, thumbnailBuffer };
    } catch (error) {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function publishEpisode(episode) {
    const episodeId = episode?.id || 'unknown';
    if (!cfg.youtubeEnabled) {
      console.warn(`[podcasts] YouTube skipped for episode ${episodeId}: disabled`);
      return { skipped: true, reason: 'disabled' };
    }
    if (!youtubeConfigured(cfg)) {
      console.warn(`[podcasts] YouTube skipped for episode ${episodeId}: oauth_not_configured`);
      return { skipped: true, reason: 'oauth_not_configured' };
    }
    const key = `youtube/${episode.id}`;
    const existing = await findAsset(key);
    if (existing?.public_url) {
      console.log(`[podcasts] YouTube skipped for episode ${episodeId}: already_uploaded ${existing.public_url}`);
      return { skipped: true, reason: 'already_uploaded', url: existing.public_url };
    }
    console.log(`[podcasts] YouTube job started for episode ${episodeId}`);
    const show = await store.getShowById(episode.show_id);
    if (!show) throw new Error(`Show not found for episode ${episodeId}`);
    const rendered = await renderVideo({ episode, show });
    try {
      console.log(`[podcasts] YouTube video rendered for episode ${episodeId}; uploading`);
      const description = `${stripHtml(episode.show_notes_html || episode.description || '')}\n\nListen and read more: ${cfg.site}/podcasts/${show.slug}/${episode.slug}\n\nFlorida Buzz is not affiliated with or endorsed by Disney.`;
      const uploaded = await uploadVideo({
        cfg,
        filePath: rendered.outputPath,
        title: episode.title,
        description,
        tags: ['Florida Buzz', 'Disney World', 'Disney World news', 'Florida travel', 'podcast'],
        privacyStatus: cfg.youtubePrivacyStatus,
        madeForKids: false,
      });
      if (rendered.thumbnailBuffer) {
        try {
          await uploadThumbnail({
            cfg,
            videoId: uploaded.id,
            imageBuffer: rendered.thumbnailBuffer,
            token: uploaded.token,
          });
          console.log(`[podcasts] YouTube custom thumbnail set for episode ${episodeId}`);
        } catch (thumbErr) {
          console.warn(`[podcasts] YouTube thumbnail upload failed for episode ${episodeId}: ${thumbErr.message}`);
        }
      }
      await store.createAsset({ kind: 'youtube', storage_path: key, public_url: uploaded.url, content_type: 'video/youtube', byte_size: null, duration_seconds: episode.duration_seconds || null, checksum: uploaded.id });
      console.log(`[podcasts] YouTube upload complete for episode ${episodeId}: ${uploaded.url}`);
      return uploaded;
    } finally {
      await fs.promises.rm(rendered.workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { planTopicVisuals, publishEpisode, renderVideo };
}

module.exports = {
  createVideoPipeline,
  fetchBuffer,
  parseJsonObject,
  planTopicVisuals,
  resolveVideoTotalSeconds,
  stripHtml,
  broadenVisualPrompt,
};
