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
const {
  broadenVisualPrompt,
  hardenPlacePrompt,
  PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS,
} = require('./videoVisuals');
const {
  findPlaceReferencePhoto,
  referenceReviewQuestion,
  withReferencePrompt,
} = require('./placeReferencePhoto');
const { fitCoverFrame, renderAgendaCard, renderBrandCard, renderThumbnailFrame, renderTopicFrame } = require('./videoCards');
const { uploadThumbnail, uploadVideo, updateVideoSnippet, youtubeConfigured } = require('./youtubeClient');
const { stillKey } = require('./youtubeStillsReview');
const { buildYoutubeDescription } = require('./youtubeDescription');

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

/**
 * Slow continuous camera pan for topic stills.
 *
 * Crop x/y are integers, so tiny travel (old ~8% overscan at 1080p) holds a few
 * frames then jumps a pixel. Pan at 2× with ~20% overscan and bilinear downscale
 * so each step is sub-pixel and looks smooth — without the 4K lanczos cost that
 * stalled App Platform renders for nearly an hour.
 *
 * Long story clips finish the pan in ~24s then hold; dragging a tiny pan across
 * a full minute reintroduces stutter. No zoompan breathing.
 */
function topicMotionFilter({ durationSeconds, sceneIndex = 0 } = {}) {
  const duration = Math.max(0.8, Number(durationSeconds) || 1);
  const fadeOut = Math.max(0, duration - 0.35).toFixed(3);
  const workW = 3840;
  const workH = 2160;
  const overscan = 1.2;
  const cropW = Math.round((1920 * 2) / overscan);
  const cropH = Math.round((1080 * 2) / overscan);
  const maxX = Math.max(1, workW - cropW);
  const maxY = Math.max(1, workH - cropH);
  const dirs = [
    { x0: 0, y0: Math.round(maxY * 0.18), x1: maxX, y1: Math.round(maxY * 0.82) },
    { x0: maxX, y0: Math.round(maxY * 0.22), x1: 0, y1: Math.round(maxY * 0.78) },
    { x0: Math.round(maxX * 0.08), y0: maxY, x1: Math.round(maxX * 0.92), y1: 0 },
    { x0: Math.round(maxX * 0.92), y0: 0, x1: Math.round(maxX * 0.08), y1: maxY },
  ];
  const dir = dirs[Math.abs(Number(sceneIndex) || 0) % dirs.length];
  // Keep ≥~1 work-px/frame so motion never plateaus; hold after the pan window.
  const panSeconds = Math.min(duration, 24);
  const progress = `min(1\\,t/${panSeconds.toFixed(3)})`;
  const xExpr = `${dir.x0}+(${dir.x1 - dir.x0})*${progress}`;
  const yExpr = `${dir.y0}+(${dir.y1 - dir.y0})*${progress}`;
  return (
    `fps=30,scale=${workW}:${workH}:flags=bilinear,` +
    `crop=${cropW}:${cropH}:'${xExpr}':'${yExpr}',` +
    `scale=1920:1080:flags=bilinear,` +
    `fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35`
  );
}

function stationaryFilter(durationSeconds) {
  const duration = Math.max(0.8, Number(durationSeconds) || 1);
  const fadeOut = Math.max(0, duration - 0.35).toFixed(3);
  return `fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.35`;
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
Return strict JSON only (no markdown): {"topics":[{"slug":"story-1","title":"short on-screen topic title","description":"max 5 words, under 32 characters","category":"stable-reusable-category","prompts":["prompt 1","prompt 2"]}]}.
Keep each description to at most 5 words and 32 characters so it fits one agenda-menu line. End on a real noun or verb — never on for/to/the/a/of. Use exactly two prompts per story. Each prompt is ONE sentence naming one real Walt Disney World PLACE from that story (architecture/attraction/setting — never people panels). Style: Mandalorian-episode cinematic illustration, natural daylight, NO yellow cast. Never celebrities/named characters/unknown panelists. Never mashups or invented attractions. No readable text. Escape all quotes inside strings. Use the transcript only as evidence.
Geography locks: Magic Kingdom ticket machines are at the entrance before the railroad bridge — never on Main Street with the castle. BoardWalk is pedestrian wood only. runDisney on park paths only. Contemporary monorail THROUGH the A-frame.`;
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

  async function applyStillColorFix(buffer) {
    const { Jimp } = require('jimp');
    const { coolYellowCast } = require('../coolYellowCast');
    const img = await Jimp.read(buffer);
    coolYellowCast(img, 0.72);
    return img.getBuffer('image/png');
  }

  async function reviewStillBuffer(buffer, scene, reference) {
    const { validateGeneratedImage, assertCompletedReview } = require('../imageValidation');
    try {
      const review = assertCompletedReview(
        await validateGeneratedImage(buffer, {
          title: scene.label,
          subject: scene.label,
          location: 'Walt Disney World Resort',
          slug: scene.visualKey,
          reviewInstructions: PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS,
          reviewQuestion: referenceReviewQuestion({
            label: scene.label,
            category: scene.category,
            reference,
          }),
        })
      );
      const ok = review?.acceptable === true && Array.isArray(review.issues) && review.issues.length === 0;
      return {
        ok,
        correction: String(review?.correction || review?.issues?.join('; ') || '').slice(0, 500),
      };
    } catch (err) {
      return { ok: false, correction: `review_unavailable: ${err.message}` };
    }
  }

  async function tryGenerateTopicStill(prompt, scene, reference) {
    if (!reference?.buffer) {
      return { rejected: true, correction: 'no_place_reference' };
    }
    let captured = null;
    const { PODCAST_YOUTUBE_ILLUSTRATION_STYLE } = require('./videoVisuals');
    const { editImageFromReference } = require('../openai');
    const lockedPrompt = withReferencePrompt(
      hardenPlacePrompt(prompt, {
        label: scene.label,
        category: scene.category,
      }),
      reference
    );
    const result = await generateValidatedImageResult(
      lockedPrompt,
      { title: scene.label, slug: scene.visualKey, subject: scene.label, location: 'Walt Disney World Resort' },
      {
        styleRequirements: PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
        reviewInstructions: PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS,
        reviewQuestion: referenceReviewQuestion({
          label: scene.label,
          category: scene.category,
          reference,
        }),
        // One AI attempt only — real photo is the backup. Saves OpenAI credits.
        maxAttempts: 1,
        generate: (text) =>
          editImageFromReference(text, reference.buffer, {
            quality: 'high',
            mimeType: reference.mimeType || 'image/png',
            inputFidelity: 'high',
          }),
        store: async (buffer) => {
          captured = buffer;
          return `memory://candidate`;
        },
      }
    );
    if (result.status === 'accepted' && captured) {
      return { buffer: await applyStillColorFix(captured), source: 'ai_from_reference' };
    }
    return { rejected: true, correction: result.correction || result.error || result.status };
  }

  /**
   * Build one verified story still. Never invent geography without a real place photo.
   * Never returns a blank title card — callers must abort publish when ok=false.
   */
  async function buildVerifiedTopicStill(scene, {
    episode,
    force = false,
    forReview = false,
    direction = '',
    storagePath: storagePathOverride = null,
  } = {}) {
    // v5 = gated place-photo stills (Mandalorian grade, no yellow, no people-primary, no invent).
    const storagePath =
      storagePathOverride
      || `youtube-visuals/v5/episodes/${safeSlug(episode.id)}/${safeSlug(scene.segmentSlug)}-${Number(scene.imageIndex) || 0}.png`;
    if (!force) {
      const existing = await findAsset(storagePath);
      if (existing?.public_url) {
        console.log(`[podcasts] Reusing verified YouTube still ${storagePath}`);
        return { ok: true, buffer: await fetchBuffer(existing.public_url), storagePath, source: 'cached' };
      }
    }

    const note = String(direction || '').trim();
    console.log(
      `[podcasts] Building verified YouTube still ${storagePath} for ${scene.label}`
      + (note ? ` (admin direction: ${note.slice(0, 120)})` : '')
    );
    const reference = await findPlaceReferencePhoto({
      label: scene.label,
      category: scene.category,
      prompt: scene.prompt,
      direction: note,
      episodeId: episode.id,
      store,
      supabase,
    });
    if (!reference?.buffer) {
      console.error(`[podcasts] STILL BLOCKED for ${scene.label}: no real place-photo template found`);
      return { ok: false, reason: 'no_place_reference', label: scene.label, storagePath };
    }
    if (reference.subjectKind === 'people') {
      console.error(`[podcasts] STILL BLOCKED for ${scene.label}: reference is people-primary`);
      return { ok: false, reason: 'reference_is_people', label: scene.label, storagePath };
    }
    console.log(
      `[podcasts] Place reference for ${scene.label}: ${reference.source} — ${reference.title || reference.imageUrl} (${reference.credit})`
    );

    const ai = await tryGenerateTopicStill(scene.prompt, scene, reference);
    if (Buffer.isBuffer(ai.buffer)) {
      await saveVisual(ai.buffer, storagePath);
      console.log(`[podcasts] Verified AI-from-reference still for ${scene.label}`);
      return { ok: true, buffer: ai.buffer, storagePath, source: ai.source, reference };
    }

    // Fallback: real place photo itself (after color fix + review) — never invent, never title card.
    console.warn(
      `[podcasts] AI restyle rejected for ${scene.label}; verifying real reference photo instead (${ai.correction || 'rejected'})`
    );
    const photo = await applyStillColorFix(reference.buffer);
    const verified = await reviewStillBuffer(photo, scene, reference);
    if (!verified.ok) {
      // For the admin review board, still surface the real photo so you can approve or reject with direction.
      if (forReview) {
        await saveVisual(photo, storagePath);
        console.warn(
          `[podcasts] Review candidate (unverified reference) for ${scene.label}: ${verified.correction}`
        );
        return {
          ok: true,
          buffer: photo,
          storagePath,
          source: 'reference_photo_unverified',
          reference,
          reviewWarning: verified.correction,
        };
      }
      console.error(
        `[podcasts] STILL BLOCKED for ${scene.label}: reference photo failed verification — ${verified.correction}`
      );
      return {
        ok: false,
        reason: 'reference_failed_verification',
        label: scene.label,
        storagePath,
        correction: verified.correction,
      };
    }
    await saveVisual(photo, storagePath);
    console.log(`[podcasts] Verified real reference photo still for ${scene.label}`);
    return { ok: true, buffer: photo, storagePath, source: 'reference_photo', reference };
  }

  async function prepareAllTopicStills(plan, { episode, force = false } = {}) {
    const topicScenes = plan.scenes.filter((scene) => scene.kind === 'topic');
    const prepared = new Map();
    const failures = [];
    for (const scene of topicScenes) {
      const key = `${scene.segmentSlug}:${Number(scene.imageIndex) || 0}`;
      const result = await buildVerifiedTopicStill(scene, { episode, force });
      if (!result.ok) {
        failures.push({
          key,
          label: scene.label,
          reason: result.reason,
          correction: result.correction || null,
        });
        continue;
      }
      prepared.set(key, result);
    }
    return { prepared, failures, topicCount: topicScenes.length };
  }

  function stillItemFromScene(scene, result = {}) {
    const id = stillKey(scene.segmentSlug, scene.imageIndex);
    return {
      id,
      segment_slug: scene.segmentSlug,
      image_index: Number(scene.imageIndex) || 0,
      label: scene.label,
      category: scene.category || '',
      prompt: scene.prompt || '',
      caption: scene.caption || '',
      visual_key: scene.visualKey || '',
      public_url: result.public_url || null,
      storage_path: result.storagePath || result.storage_path || null,
      source: result.source || null,
      status: result.status || 'pending',
      rejection_note: result.rejection_note || '',
      error: result.error || null,
      reference_credit: result.reference?.credit || result.reference_credit || null,
    };
  }

  async function buildScenePlanForEpisode(episode, { forcePlan = false } = {}) {
    if (!episode.audio_url) throw new Error('Episode has no permanent audio URL');
    const show = await store.getShowById(episode.show_id);
    if (!show) throw new Error(`Show not found for episode ${episode.id}`);
    const [audioBuffer, topicMeta] = await Promise.all([
      fetchBuffer(episode.audio_url),
      planTopicVisuals({ episode, aiText }),
    ]);
    const probedSeconds = await probeMp3DurationSec(audioBuffer, ffmpegPath);
    const totalSeconds = resolveVideoTotalSeconds(episode.duration_seconds, probedSeconds);
    if (
      forcePlan ||
      !Number(episode.duration_seconds) ||
      Math.abs(Number(episode.duration_seconds) - totalSeconds) > 1
    ) {
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
    return { plan, show, totalSeconds, topicMeta };
  }

  /**
   * Generate (or reuse) every story still for admin review. Does not assemble video.
   */
  async function prepareStillsBoard(episode, { force = false, existingBoard = null, onProgress = null } = {}) {
    const { plan } = await buildScenePlanForEpisode(episode);
    const topicScenes = plan.scenes.filter((scene) => scene.kind === 'topic');
    const prior = new Map((existingBoard?.items || []).map((item) => [item.id, item]));
    const items = [];
    let failedCount = 0;
    for (const scene of topicScenes) {
      const id = stillKey(scene.segmentSlug, scene.imageIndex);
      const previous = prior.get(id);
      if (!force && previous?.status === 'approved' && previous.public_url) {
        items.push({
          ...stillItemFromScene(scene, previous),
          status: 'approved',
          public_url: previous.public_url,
          storage_path: previous.storage_path || previous.storagePath || null,
          source: previous.source || 'approved',
          rejection_note: previous.rejection_note || '',
        });
        continue;
      }
      const result = await buildVerifiedTopicStill(scene, {
        episode,
        force: force || Boolean(previous?.rejection_note),
        forReview: true,
      });
      if (!result.ok) {
        failedCount += 1;
        items.push(
          stillItemFromScene(scene, {
            status: 'failed',
            storagePath: result.storagePath,
            error: `${result.reason}${result.correction ? `: ${result.correction}` : ''}`,
            rejection_note: previous?.rejection_note || '',
          })
        );
        // Persist partial progress so the dashboard fills in while later stories generate.
        if (typeof onProgress === 'function') {
          await onProgress({ items: [...items], failedCount, topicCount: topicScenes.length });
        }
        continue;
      }
      const asset = await findAsset(result.storagePath);
      const publicUrl = asset?.public_url || (await saveVisual(result.buffer, result.storagePath));
      items.push(
        stillItemFromScene(scene, {
          status: 'ready',
          public_url: publicUrl,
          storagePath: result.storagePath,
          source: result.source,
          reference: result.reference,
          rejection_note: '',
          error: result.reviewWarning || null,
        })
      );
      if (typeof onProgress === 'function') {
        await onProgress({ items: [...items], failedCount, topicCount: topicScenes.length });
      }
    }
    return { items, failedCount, topicCount: topicScenes.length };
  }

  /**
   * Rebuild one rejected still using optional admin direction text.
   * Approved siblings on the board are untouched — only this stillId is rebuilt.
   */
  async function regenerateStillForReview(episode, stillId, { direction = '' } = {}) {
    const { plan } = await buildScenePlanForEpisode(episode);
    const scene = plan.scenes.find(
      (entry) => entry.kind === 'topic' && stillKey(entry.segmentSlug, entry.imageIndex) === stillId
    );
    if (!scene) throw new Error(`Still scene not found for ${stillId}`);
    const note = String(direction || '').trim();
    const directedScene = note
      ? {
          ...scene,
          // Direction becomes the visual subject; keep original label only for admin card title.
          prompt: `Admin-requested YouTube still. Follow this direction exactly: ${note}. `
            + `Show one real Walt Disney World place matching that direction. `
            + `Original story context (do not override the direction): ${scene.label}.`,
        }
      : scene;
    // New storage path every regen so CDN/browser cache cannot show the previous still.
    const storagePath =
      `youtube-visuals/v5/episodes/${safeSlug(episode.id)}/`
      + `${safeSlug(scene.segmentSlug)}-${Number(scene.imageIndex) || 0}-r${Date.now().toString(36)}.png`;
    const result = await buildVerifiedTopicStill(directedScene, {
      episode,
      force: true,
      forReview: true,
      direction: note,
      storagePath,
    });
    if (!result.ok) {
      return stillItemFromScene(scene, {
        status: 'failed',
        storagePath: result.storagePath,
        error: `${result.reason}${result.correction ? `: ${result.correction}` : ''}`,
        rejection_note: note,
      });
    }
    const asset = await findAsset(result.storagePath);
    const publicUrl = asset?.public_url || (await saveVisual(result.buffer, result.storagePath));
    return stillItemFromScene(scene, {
      status: 'ready',
      public_url: publicUrl,
      storagePath: result.storagePath,
      source: result.source,
      reference: result.reference,
      rejection_note: note,
      error: result.reviewWarning || null,
    });
  }

  async function loadApprovedStillsMap(board) {
    const prepared = new Map();
    const failures = [];
    for (const item of board?.items || []) {
      const key = `${item.segment_slug}:${Number(item.image_index) || 0}`;
      if (item.status !== 'approved' || !item.public_url) {
        failures.push({
          key,
          label: item.label,
          reason: item.status === 'failed' ? 'failed' : 'not_approved',
          correction: item.error || item.rejection_note || null,
        });
        continue;
      }
      try {
        const buffer = await fetchBuffer(item.public_url);
        prepared.set(key, {
          ok: true,
          buffer,
          storagePath: item.storage_path,
          source: item.source || 'approved_board',
        });
      } catch (err) {
        failures.push({ key, label: item.label, reason: 'download_failed', correction: err.message });
      }
    }
    return { prepared, failures };
  }

  async function runFfmpeg(args) {
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 8 * 1024 * 1024 });
  }

  async function renderVideo({ episode, show, force = false, approvedStillsBoard = null } = {}) {
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
      const topicCount = plan.scenes.filter((scene) => scene.kind === 'topic').length;
      let prepared;
      let failures;
      if (approvedStillsBoard) {
        // Admin-approved board is the only still source when creating the video.
        ({ prepared, failures } = await loadApprovedStillsMap(approvedStillsBoard));
        if (failures.length || prepared.size < topicCount) {
          const summary = failures.map((f) => `${f.label} (${f.reason})`).join('; ') || 'incomplete approved still set';
          const err = new Error(`YouTube stills not fully approved — refusing to render/publish: ${summary}`);
          err.code = 'STILLS_INCOMPLETE';
          err.failures = failures;
          console.error(`[podcasts] ${err.message}`);
          throw err;
        }
        console.log(
          `[podcasts] Using ${prepared.size} admin-approved story stills for episode ${episode.id}; assembling video`
        );
      } else {
        // Legacy path: generate + verify stills inline (blocked for normal publish; admin review required).
        ({ prepared, failures } = await prepareAllTopicStills(plan, { episode, force }));
        if (failures.length || prepared.size < topicCount) {
          const summary = failures.map((f) => `${f.label} (${f.reason})`).join('; ') || 'incomplete still set';
          const err = new Error(`YouTube stills incomplete — refusing to render/publish: ${summary}`);
          err.code = 'STILLS_INCOMPLETE';
          err.failures = failures;
          console.error(`[podcasts] ${err.message}`);
          throw err;
        }
        console.log(`[podcasts] All ${prepared.size} story stills verified for episode ${episode.id}; assembling video`);
      }

      const agendaBuffer = await renderAgendaCard({ coverBuffer, topics: plan.topics, footer: agendaFooter });
      const brandBuffer = await renderBrandCard({
        coverBuffer,
        label: 'Florida Buzz Disney Podcast',
        cta: 'Like & Subscribe',
      });
      // Square podcast artwork must letterbox into 16:9 — never crop FLORIDA BUZZ off the top.
      const coverFrame = await fitCoverFrame(coverBuffer);
      const sceneClips = [];
      let thumbnailBuffer = null;
      let topicMotionIndex = 0;
      for (let i = 0; i < plan.scenes.length; i += 1) {
        const scene = plan.scenes[i];
        let imageBuffer;
        if (scene.kind === 'topic') {
          const key = `${scene.segmentSlug}:${Number(scene.imageIndex) || 0}`;
          const still = prepared.get(key);
          if (!still?.buffer) {
            const err = new Error(`Missing verified still for ${scene.label}`);
            err.code = 'STILLS_INCOMPLETE';
            throw err;
          }
          imageBuffer = await renderTopicFrame(still.buffer, {
            label: scene.label,
            category: scene.category,
            caption: scene.caption,
            aiLabel: false,
          });
          if (!thumbnailBuffer) {
            thumbnailBuffer = await renderThumbnailFrame(still.buffer, {
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
        // Topic stills get a slow continuous pan (2× work-res crop). Cover/agenda/brand stay still.
        const vf =
          scene.kind === 'topic'
            ? topicMotionFilter({ durationSeconds: duration, sceneIndex: topicMotionIndex++ })
            : stationaryFilter(duration);
        const startedAt = Date.now();
        console.log(
          `[podcasts] Rendering YouTube clip ${i + 1}/${plan.scenes.length} kind=${scene.kind} ` +
            `dur=${duration.toFixed(1)}s label=${String(scene.label || scene.kind).slice(0, 60)}`
        );
        await runFfmpeg([
          '-loop', '1', '-i', imagePath,
          '-vf', vf,
          // ultrafast keeps App Platform under ~realtime for long still pans
          '-t', duration.toFixed(3), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', clipPath,
        ]);
        console.log(
          `[podcasts] YouTube clip ${i + 1}/${plan.scenes.length} done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
        );
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

  async function publishEpisode(episode, { force = false, approvedStillsBoard = null } = {}) {
    const episodeId = episode?.id || 'unknown';
    if (!cfg.youtubeEnabled) {
      console.warn(`[podcasts] YouTube skipped for episode ${episodeId}: disabled`);
      return { skipped: true, reason: 'disabled' };
    }
    if (!youtubeConfigured(cfg)) {
      console.warn(`[podcasts] YouTube skipped for episode ${episodeId}: oauth_not_configured`);
      return { skipped: true, reason: 'oauth_not_configured' };
    }
    if (!approvedStillsBoard) {
      console.warn(
        `[podcasts] YouTube skipped for episode ${episodeId}: stills_review_required (approve stills on the podcast dashboard first)`
      );
      return { skipped: true, reason: 'stills_review_required' };
    }
    const key = `youtube/${episode.id}`;
    const existing = await findAsset(key);
    if (existing?.public_url && !force) {
      console.log(`[podcasts] YouTube skipped for episode ${episodeId}: already_uploaded ${existing.public_url}`);
      return { skipped: true, reason: 'already_uploaded', url: existing.public_url };
    }
    if (force && existing?.public_url) {
      console.warn(`[podcasts] YouTube force rebuild for episode ${episodeId}; prior upload was ${existing.public_url}`);
      if (typeof store.deleteAssetByStoragePath === 'function') {
        await store.deleteAssetByStoragePath(key).catch((err) => {
          console.warn(`[podcasts] Could not clear prior YouTube asset row: ${err.message}`);
        });
      }
    }
    console.log(`[podcasts] YouTube job started for episode ${episodeId}${force ? ' (force)' : ''} (approved stills)`);
    const show = await store.getShowById(episode.show_id);
    if (!show) throw new Error(`Show not found for episode ${episodeId}`);
    let rendered;
    try {
      rendered = await renderVideo({ episode, show, force, approvedStillsBoard });
    } catch (err) {
      if (err?.code === 'STILLS_INCOMPLETE') {
        console.error(`[podcasts] YouTube NOT published for episode ${episodeId}: stills_incomplete`);
        return {
          skipped: true,
          reason: 'stills_incomplete',
          failures: err.failures || [],
          error: err.message,
        };
      }
      throw err;
    }
    try {
      console.log(`[podcasts] YouTube video rendered for episode ${episodeId}; uploading`);
      let sources = [];
      if (typeof store.listSources === 'function') {
        sources = await store.listSources(episode.id).catch(() => []);
      }
      const description = buildYoutubeDescription({
        episode,
        show,
        site: cfg.site,
        sources,
      });
      const uploaded = await uploadVideo({
        cfg,
        filePath: rendered.outputPath,
        title: episode.title,
        description,
        tags: ['Florida Buzz', 'Disney World', 'Disney World news', 'Florida travel', 'podcast', 'like and subscribe'],
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

  async function updatePublishedDescription(episode) {
    const episodeId = episode?.id || 'unknown';
    if (!youtubeConfigured(cfg)) throw new Error('YouTube OAuth credentials are not configured');
    const key = `youtube/${episode.id}`;
    const existing = await findAsset(key);
    const url = existing?.public_url || getStillsBoardYoutubeUrl(episode);
    const videoId = youtubeIdFromUrl(url) || existing?.checksum;
    if (!videoId) throw new Error('No YouTube video id found for this episode');
    const show = await store.getShowById(episode.show_id);
    if (!show) throw new Error(`Show not found for episode ${episodeId}`);
    let sources = [];
    if (typeof store.listSources === 'function') {
      sources = await store.listSources(episode.id).catch(() => []);
    }
    const description = buildYoutubeDescription({ episode, show, site: cfg.site, sources });
    const result = await updateVideoSnippet({
      cfg,
      videoId,
      title: episode.title,
      description,
      tags: ['Florida Buzz', 'Disney World', 'Disney World news', 'Florida travel', 'podcast', 'like and subscribe'],
    });
    console.log(`[podcasts] YouTube description updated for episode ${episodeId}: https://youtu.be/${videoId}`);
    return { id: videoId, url: `https://youtu.be/${videoId}`, description, result };
  }

  return {
    planTopicVisuals,
    publishEpisode,
    renderVideo,
    prepareAllTopicStills,
    buildVerifiedTopicStill,
    prepareStillsBoard,
    regenerateStillForReview,
    buildScenePlanForEpisode,
    updatePublishedDescription,
  };
}

function youtubeIdFromUrl(url) {
  const text = String(url || '');
  const m =
    text.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/) ||
    text.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) ||
    text.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function getStillsBoardYoutubeUrl(episode) {
  const outline = episode?.outline_json && typeof episode.outline_json === 'object' ? episode.outline_json : {};
  return outline.youtube_stills?.youtube_url || null;
}

module.exports = {
  createVideoPipeline,
  fetchBuffer,
  parseJsonObject,
  planTopicVisuals,
  resolveVideoTotalSeconds,
  stripHtml,
  topicMotionFilter,
  stationaryFilter,
  broadenVisualPrompt,
};
