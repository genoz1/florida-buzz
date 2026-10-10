'use strict';

/**
 * Gateway timeouts leave orphan rows:
 * - generation_runs stuck at "running" with no episode link
 * - episodes stuck at "generating_audio" with no finished master
 *
 * Recover those so admin can open the episode and retry fal TTS manually.
 */

async function recoverStuckPodcastWork(store, {
  showSlug,
  now = new Date(),
  staleMs = Number(process.env.PODCASTS_RUNNING_STALE_MS || 15 * 60 * 1000),
} = {}) {
  const recovered = { runs: 0, episodes: 0 };
  if (!store) return recovered;

  const runs = typeof store.listGenerationRuns === 'function'
    ? await store.listGenerationRuns(showSlug, null, 40)
    : [];
  for (const run of runs) {
    if (run.status !== 'running') continue;
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
    if (episode.status !== 'generating_audio') continue;
    const updatedMs = Date.parse(episode.updated_at || '') || 0;
    if (!updatedMs || now.getTime() - updatedMs < staleMs) continue;
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

  return recovered;
}

module.exports = { recoverStuckPodcastWork };
