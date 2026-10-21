'use strict';

/**
 * Admin-gated YouTube stills review.
 * Publish podcast → generate stills for review → approve/reject (with direction)
 * → only then assemble and upload the YouTube video.
 */

function stillKey(segmentSlug, imageIndex) {
  return `${String(segmentSlug || 'story')}-${Number(imageIndex) || 0}`;
}

function getStillsBoard(episode) {
  const outline = episode?.outline_json && typeof episode.outline_json === 'object' ? episode.outline_json : {};
  const board = outline.youtube_stills;
  if (!board || typeof board !== 'object') {
    return {
      status: 'idle',
      updated_at: null,
      items: [],
      youtube_url: null,
      last_error: null,
    };
  }
  return {
    status: board.status || 'idle',
    updated_at: board.updated_at || null,
    items: Array.isArray(board.items) ? board.items : [],
    youtube_url: board.youtube_url || null,
    last_error: board.last_error || null,
  };
}

async function saveStillsBoard(store, episode, board) {
  const outline =
    episode.outline_json && typeof episode.outline_json === 'object' ? { ...episode.outline_json } : {};
  const next = {
    status: board.status || 'idle',
    updated_at: new Date().toISOString(),
    items: Array.isArray(board.items) ? board.items : [],
    youtube_url: board.youtube_url || null,
    last_error: board.last_error || null,
  };
  outline.youtube_stills = next;
  const updated = await store.updateEpisode(episode.id, { outline_json: outline });
  return { episode: updated, board: next };
}

function allStillsApproved(board) {
  const items = board?.items || [];
  return items.length > 0 && items.every((item) => item.status === 'approved' && item.public_url);
}

function boardSummary(board) {
  const items = board?.items || [];
  const counts = {
    approved: 0,
    ready: 0,
    rejected: 0,
    failed: 0,
    pending: 0,
    generating: 0,
    regenerating: 0,
  };
  for (const item of items) {
    const key = counts[item.status] != null ? item.status : 'pending';
    counts[key] += 1;
  }
  return { total: items.length, ...counts, allApproved: allStillsApproved(board) };
}

/**
 * Dashboard meter for YouTube stills → video pipeline.
 * percent is 0–100 for the progress bar; state drives panel color.
 */
function describeYoutubeProgress(episode, { now = Date.now() } = {}) {
  const board = getStillsBoard(episode);
  const summary = boardSummary(board);
  const updatedMs = board.updated_at ? Date.parse(board.updated_at) || 0 : 0;
  const ageMs = updatedMs ? Math.max(0, now - updatedMs) : null;
  const status = board.status || 'idle';

  if (status === 'video_published' && board.youtube_url) {
    return {
      state: 'done',
      phase: 'video_published',
      label: 'YouTube video published',
      detail: board.youtube_url,
      percent: 100,
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: false,
    };
  }

  if (status === 'building_video') {
    return {
      state: 'live',
      phase: 'building_video',
      label: 'Building YouTube video',
      detail:
        'Assembling approved stills with episode audio and uploading to YouTube. This often takes 30–60+ minutes — keep this tab open or refresh later.',
      percent: 85,
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: true,
    };
  }

  if (status === 'failed') {
    return {
      state: 'failed',
      phase: 'failed',
      label: 'YouTube stills / video failed',
      detail: board.last_error || 'Check stills below, then regenerate or create video again.',
      percent: summary.total ? Math.round((summary.approved / summary.total) * 70) : 0,
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: false,
    };
  }

  if (status === 'generating' || summary.regenerating > 0) {
    const doneItems = summary.approved + summary.ready + summary.failed;
    const denom = Math.max(summary.total, doneItems, 1);
    const base = Math.round((doneItems / denom) * 55);
    return {
      state: 'live',
      phase: summary.regenerating > 0 ? 'regenerating' : 'generating_stills',
      label: summary.regenerating > 0 ? 'Regenerating YouTube still(s)' : 'Generating YouTube stills',
      detail: summary.total
        ? `${doneItems}/${summary.total} stills ready so far`
          + (summary.regenerating ? ` · ${summary.regenerating} regenerating` : '')
          + '. Each still can take a few minutes.'
        : 'Planning topics and fetching place photos…',
      percent: Math.min(70, Math.max(8, base)),
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: true,
    };
  }

  if (summary.allApproved || status === 'approved') {
    return {
      state: 'ready',
      phase: 'approved',
      label: 'All stills approved — ready to create video',
      detail: board.last_error
        || 'Click Create YouTube video. Render + upload usually takes 30–60+ minutes.',
      percent: 75,
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: false,
    };
  }

  if (summary.total > 0 || status === 'ready_for_review') {
    const pct = summary.total ? Math.round((summary.approved / summary.total) * 70) : 10;
    return {
      state: summary.failed ? 'uncertain' : 'ready',
      phase: 'ready_for_review',
      label: 'YouTube stills ready for review',
      detail:
        `${summary.approved}/${summary.total} approved`
        + (summary.ready ? ` · ${summary.ready} waiting` : '')
        + (summary.failed ? ` · ${summary.failed} failed` : '')
        + '. Approve every still before the video can be created.',
      percent: Math.max(15, pct),
      summary,
      youtube_url: board.youtube_url,
      ageMs,
      live: false,
    };
  }

  if (episode?.status === 'published') {
    return {
      state: 'idle',
      phase: 'idle',
      label: 'YouTube stills not started',
      detail: 'Click Generate stills for review (or publish queues this automatically).',
      percent: 0,
      summary,
      youtube_url: null,
      ageMs,
      live: false,
    };
  }

  return {
    state: 'idle',
    phase: 'idle',
    label: 'YouTube pipeline idle',
    detail: 'Publish the podcast to start YouTube stills review.',
    percent: 0,
    summary,
    youtube_url: null,
    ageMs,
    live: false,
  };
}

function createYoutubeStillsReview({ store, cfg, videoPipeline }) {
  async function prepareStillsForReview(episode, { force = false } = {}) {
    if (!videoPipeline?.prepareStillsBoard) {
      throw new Error('Video pipeline stills board prepare is unavailable');
    }
    let { board } = await saveStillsBoard(store, episode, {
      ...getStillsBoard(episode),
      status: 'generating',
      last_error: null,
    });
    try {
      const fresh = await store.getEpisodeById(episode.id);
      const result = await videoPipeline.prepareStillsBoard(fresh, {
        force,
        existingBoard: getStillsBoard(fresh),
        onProgress: async ({ items, failedCount }) => {
          const latest = await store.getEpisodeById(episode.id);
          await saveStillsBoard(store, latest, {
            status: 'generating',
            items,
            youtube_url: getStillsBoard(latest).youtube_url,
            last_error: failedCount
              ? `${failedCount} still(s) failed so far — others still generating`
              : null,
          });
        },
      });
      ({ board } = await saveStillsBoard(store, await store.getEpisodeById(episode.id), {
        status: 'ready_for_review',
        items: result.items,
        youtube_url: getStillsBoard(await store.getEpisodeById(episode.id)).youtube_url,
        last_error: result.failedCount
          ? `${result.failedCount} still(s) failed generation — reject/retry those before creating the video`
          : null,
      }));
      console.log(
        `[podcasts] YouTube stills ready for review on episode ${episode.id}: ${result.items.length} item(s), ${result.failedCount} failed`
      );
      return board;
    } catch (err) {
      const fresh = await store.getEpisodeById(episode.id);
      await saveStillsBoard(store, fresh, {
        ...getStillsBoard(fresh),
        status: 'failed',
        last_error: err.message,
      });
      throw err;
    }
  }

  function queueStillsPrepare({ episode, force = false }) {
    if (!cfg?.youtubeEnabled) {
      console.warn(`[podcasts] YouTube stills not queued for episode ${episode.id}: youtube disabled`);
      return { queued: false, reason: 'youtube_disabled' };
    }
    setImmediate(() => {
      Promise.resolve()
        .then(() => prepareStillsForReview(episode, { force }))
        .then((board) => {
          console.log(
            `[podcasts] YouTube stills queue finished for episode ${episode.id}: status=${board.status} items=${board.items.length}`
          );
        })
        .catch((err) => {
          console.error(`[podcasts] YouTube stills prepare failed for episode ${episode.id}:`, err.message);
        });
    });
    return { queued: true };
  }

  async function approveStill(episode, stillId) {
    const board = getStillsBoard(episode);
    const items = board.items.map((item) => {
      if (item.id !== stillId) return item;
      if (!item.public_url) throw new Error('Cannot approve a still without an image URL');
      return { ...item, status: 'approved', rejection_note: item.rejection_note || '' };
    });
    if (!items.some((item) => item.id === stillId)) throw new Error('Still not found');
    const nextStatus = items.every((item) => item.status === 'approved') ? 'approved' : 'ready_for_review';
    return saveStillsBoard(store, episode, { ...board, status: nextStatus, items, last_error: null });
  }

  async function approveAllStills(episode) {
    const board = getStillsBoard(episode);
    const items = board.items.map((item) => {
      if (!item.public_url || item.status === 'failed') {
        throw new Error(`Cannot approve-all: "${item.label}" has no usable image`);
      }
      return { ...item, status: 'approved' };
    });
    if (!items.length) throw new Error('No stills to approve — prepare stills first');
    return saveStillsBoard(store, episode, { ...board, status: 'approved', items, last_error: null });
  }

  async function rejectStill(episode, stillId, note = '') {
    if (!videoPipeline?.regenerateStillForReview) {
      throw new Error('Still regeneration unavailable');
    }
    const direction = String(note || '').trim().slice(0, 800);
    const board = getStillsBoard(episode);
    const target = board.items.find((item) => item.id === stillId);
    if (!target) throw new Error('Still not found');

    let working = board.items.map((item) =>
      item.id === stillId
        ? {
            ...item,
            status: 'regenerating',
            rejection_note: direction,
            error: null,
          }
        : item
    );
    await saveStillsBoard(store, episode, {
      ...board,
      status: 'generating',
      items: working,
      last_error: null,
    });

    const fresh = await store.getEpisodeById(episode.id);
    const regenerated = await videoPipeline.regenerateStillForReview(fresh, stillId, { direction });
    const latest = getStillsBoard(await store.getEpisodeById(episode.id));
    working = latest.items.map((item) => (item.id === stillId ? regenerated : item));
    const nextStatus = working.every((item) => item.status === 'approved')
      ? 'approved'
      : 'ready_for_review';
    return saveStillsBoard(store, await store.getEpisodeById(episode.id), {
      ...latest,
      status: nextStatus,
      items: working,
      last_error: regenerated.status === 'failed' ? regenerated.error : null,
    });
  }

  async function createVideoFromApprovedStills(episode, { force = false } = {}) {
    const board = getStillsBoard(episode);
    if (!allStillsApproved(board)) {
      throw new Error('Approve every YouTube still before creating the video');
    }
    await saveStillsBoard(store, episode, { ...board, status: 'building_video', last_error: null });
    try {
      const result = await videoPipeline.publishEpisode(
        { ...episode, status: 'published' },
        { force: true, approvedStillsBoard: board }
      );
      if (result?.skipped) {
        await saveStillsBoard(store, await store.getEpisodeById(episode.id), {
          ...getStillsBoard(await store.getEpisodeById(episode.id)),
          status: 'approved',
          last_error: `Video skipped: ${result.reason}`,
        });
        return result;
      }
      const url = result?.url || null;
      await saveStillsBoard(store, await store.getEpisodeById(episode.id), {
        ...getStillsBoard(await store.getEpisodeById(episode.id)),
        status: 'video_published',
        youtube_url: url,
        last_error: null,
      });
      return result;
    } catch (err) {
      await saveStillsBoard(store, await store.getEpisodeById(episode.id), {
        ...getStillsBoard(await store.getEpisodeById(episode.id)),
        status: 'approved',
        last_error: err.message,
      });
      throw err;
    }
  }

  function queueCreateVideo({ episode }) {
    setImmediate(() => {
      Promise.resolve()
        .then(() => createVideoFromApprovedStills(episode, { force: true }))
        .then((result) => {
          if (result?.skipped) {
            console.warn(`[podcasts] YouTube create-from-stills skipped for ${episode.id}: ${result.reason}`);
            return;
          }
          console.log(`[podcasts] YouTube create-from-stills finished for ${episode.id}: ${result?.url || 'ok'}`);
        })
        .catch((err) => {
          console.error(`[podcasts] YouTube create-from-stills failed for ${episode.id}:`, err.message);
        });
    });
    return { queued: true };
  }

  return {
    getStillsBoard,
    saveStillsBoard,
    allStillsApproved,
    boardSummary,
    prepareStillsForReview,
    queueStillsPrepare,
    approveStill,
    approveAllStills,
    rejectStill,
    createVideoFromApprovedStills,
    queueCreateVideo,
  };
}

module.exports = {
  stillKey,
  getStillsBoard,
  allStillsApproved,
  boardSummary,
  describeYoutubeProgress,
  createYoutubeStillsReview,
};
