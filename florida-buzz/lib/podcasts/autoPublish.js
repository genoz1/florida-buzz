'use strict';

/**
 * Hands-off publish after private preview audio is ready.
 * preview_ready → approved → published, then queue YouTube (same as admin Publish).
 */

function isScaffoldEpisode(episode) {
  const outline = episode?.outline_json || {};
  if (outline.fallback === true) return true;
  const script = String(episode?.script_text || '').trim();
  if (script.length < 400) return true;
  if (/scaffold-only|do not publish/i.test(String(episode?.last_error || ''))) return true;
  return false;
}

function queueYouTubePublish({ episode, cfg, videoPipeline, force = false }) {
  if (!cfg?.youtubeEnabled) {
    console.warn(`[podcasts] YouTube not queued for episode ${episode.id}: PODCASTS_YOUTUBE_ENABLED is false`);
    return { queued: false, reason: 'youtube_disabled' };
  }
  if (!videoPipeline?.publishEpisode) {
    console.warn(`[podcasts] YouTube not queued for episode ${episode.id}: video pipeline unavailable`);
    return { queued: false, reason: 'pipeline_unavailable' };
  }
  setImmediate(() => {
    Promise.resolve()
      .then(() => videoPipeline.publishEpisode({ ...episode, status: 'published' }, { force }))
      .then((result) => {
        if (result?.skipped) {
          console.warn(`[podcasts] YouTube queue finished for episode ${episode.id}: skipped (${result.reason})`);
          return;
        }
        console.log(`[podcasts] YouTube queue finished for episode ${episode.id}: ${result?.url || result?.id || 'ok'}`);
      })
      .catch((err) => {
        console.error(`[podcasts] YouTube automation failed for episode ${episode.id}:`, err.message);
      });
  });
  return { queued: true };
}

/**
 * Approve + publish an episode that already has permanent audio.
 * Idempotent for already-published episodes.
 */
async function approveAndPublishEpisode({
  store,
  episode,
  cfg,
  videoPipeline = null,
  reason = 'auto_publish',
} = {}) {
  if (!episode?.id) throw new Error('approveAndPublishEpisode requires an episode');
  const fresh = (await store.getEpisodeById(episode.id)) || episode;

  if (fresh.status === 'published' && fresh.audio_url) {
    console.info(`[podcasts] auto-publish skipped for ${fresh.id}: already published`);
    return { skipped: true, reason: 'already_published', episode: fresh };
  }
  if (!cfg?.autoPublish) {
    return { skipped: true, reason: 'auto_publish_disabled', episode: fresh };
  }
  if (!fresh.audio_url) {
    throw new Error(`Cannot auto-publish episode ${fresh.id}: missing audio_url`);
  }
  if (isScaffoldEpisode(fresh)) {
    console.warn(`[podcasts] auto-publish refused for ${fresh.id}: scaffold/fallback script`);
    return { skipped: true, reason: 'scaffold_script', episode: fresh };
  }
  if (!['preview_ready', 'approved', 'scheduled'].includes(fresh.status)) {
    console.warn(`[podcasts] auto-publish skipped for ${fresh.id}: status=${fresh.status}`);
    return { skipped: true, reason: `status_${fresh.status}`, episode: fresh };
  }

  if (fresh.status === 'preview_ready') {
    await store.setStatus(fresh.id, 'approved');
    console.info(`[podcasts] auto-approved episode ${fresh.id} (${reason})`);
  }

  const approved = (await store.getEpisodeById(fresh.id)) || fresh;
  if (approved.status !== 'published') {
    if (!['approved', 'scheduled'].includes(approved.status)) {
      throw new Error(`Cannot auto-publish episode ${approved.id} from status ${approved.status}`);
    }
    await store.setStatus(approved.id, 'published');
    console.info(`[podcasts] auto-published episode ${approved.id} (${reason})`);
  }

  const published = (await store.getEpisodeById(fresh.id)) || approved;
  const youtube = queueYouTubePublish({ episode: published, cfg, videoPipeline });
  return { skipped: false, episode: published, youtube, reason };
}

/** Fire-and-forget wrapper used after preview_ready. */
function maybeAutoPublishAfterPreview({ store, episode, cfg, videoPipeline }) {
  if (!cfg?.autoPublish) return;
  setImmediate(() => {
    Promise.resolve()
      .then(() =>
        approveAndPublishEpisode({
          store,
          episode,
          cfg,
          videoPipeline,
          reason: 'preview_ready',
        })
      )
      .then((result) => {
        if (result?.skipped) {
          console.info(`[podcasts] auto-publish after preview skipped for ${episode.id}: ${result.reason}`);
          return;
        }
        console.info(`[podcasts] auto-publish after preview finished for ${episode.id}`);
      })
      .catch((err) => {
        console.error(`[podcasts] auto-publish after preview failed for ${episode.id}:`, err.message);
      });
  });
}

module.exports = {
  approveAndPublishEpisode,
  isScaffoldEpisode,
  maybeAutoPublishAfterPreview,
  queueYouTubePublish,
};
