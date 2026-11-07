'use strict';

/**
 * Gateway timeouts / redeploys leave orphan rows:
 * - generation_runs stuck at "running" with no episode link
 * - episodes stuck at "generating_audio" with no finished master
 * - youtube_stills boards stuck at "building_video" after process death mid-render
 *
 * Recover those so admin can open the episode and retry.
 */

const { getStillsBoard } = require('./youtubeStillsReview');

async function recoverStuckPodcastWork(store, {
  showSlug,
  onYoutubeRecovered,
  recoverAudio = true,
  now = new Date(),
  staleMs = Number(process.env.PODCASTS_RUNNING_STALE_MS || 15 * 60 * 1000),
  youtubeBuildingStaleMs = Number(
    process.env.PODCASTS_YOUTUBE_BUILDING_STALE_MS || 2 * 60 * 60 * 1000
  ),
} = {}) {
  const recovered = { runs: 0, episodes: 0, youtubeBoards: 0 };
  if (!store) return recovered;

  const runs = typeof store.listGenerationRuns === 'function'
    ? await store.listGenerationRuns(showSlug, null, 40)
    : [];
  for (const run of runs) {
    if (!recoverAudio || run.status !== 'running') continue;
    const startedMs = Date.parse(run.updated_at || run.created_at || '') || 0;
    if (!startedMs || now.getTime() - startedMs < staleMs) continue;
    await store.updateGenerationRun(run.id, {
      status: 'failed',
      error_detail:
        'Marked failed: weekly draft was still running too long (likely gateway timeout during script/audio). Open an existing episode and use Save / generate script or Generate private preview.',
    });
    recovered.runs += 1;
  }

  const show = typeof store.getShow === 'function' ? await store.getShow(showSlug) : null;
  const episodes = show && typeof store.listEpisodes === 'function'
    ? await store.listEpisodes(show.id)
    : [];
  for (const episode of episodes) {
    if (recoverAudio && episode.status === 'generating_audio') {
      const updatedMs = Date.parse(episode.updated_at || '') || 0;
      if (updatedMs && now.getTime() - updatedMs >= staleMs) {
        // Prefer setStatus when transitions allow; fall back to patch.
        try {
          await store.setStatus(episode.id, 'script_ready');
        } catch {
          await store.updateEpisode(episode.id, { status: 'script_ready' });
        }
        await store.updateEpisode(episode.id, {
          last_error:
            'Audio generation was interrupted (likely gateway timeout). Script is kept — click Generate private preview (fal TTS) to retry. Do not Approve until preview audio finishes.',
        });
        recovered.episodes += 1;

        if (episode.generation_run_id && typeof store.updateGenerationRun === 'function') {
          await store.updateGenerationRun(episode.generation_run_id, {
            status: 'draft_ready',
            episode_id: episode.id,
            error_detail: null,
          }).catch(() => {});
        }
      }
    }

    const board = getStillsBoard(episode);
    if (board.status !== 'building_video' || board.youtube_url) continue;
    const boardUpdatedMs = Date.parse(board.updated_at || episode.updated_at || '') || 0;
    if (!boardUpdatedMs || now.getTime() - boardUpdatedMs < youtubeBuildingStaleMs) continue;

    const outline =
      episode.outline_json && typeof episode.outline_json === 'object'
        ? { ...episode.outline_json }
        : {};
    outline.youtube_stills = {
      ...board,
      status: 'approved',
      updated_at: now.toISOString(),
      last_error:
        'YouTube video build was interrupted (redeploy or process restart). Approved stills are kept — click Create YouTube video to retry.',
    };
    const updated = await store.updateEpisode(episode.id, { outline_json: outline });
    recovered.youtubeBoards += 1;
    if (onYoutubeRecovered) await onYoutubeRecovered(updated);
  }

  return recovered;
}

module.exports = { recoverStuckPodcastWork };
