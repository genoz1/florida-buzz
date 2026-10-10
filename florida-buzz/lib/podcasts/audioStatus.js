'use strict';

/**
 * Honest audio-generation liveness for admin UI.
 * Heartbeats are written on every fal poll; if updated_at stops moving, the
 * process is dead even if status still says "running".
 */

function describeAudioProgress({
  episode,
  jobs = [],
  now = Date.now(),
  liveWithinMs = Number(process.env.PODCASTS_AUDIO_LIVE_MS || 45000),
  staleAfterMs = Number(process.env.PODCASTS_AUDIO_STALE_MS || 120000),
} = {}) {
  const latest = Array.isArray(jobs) && jobs.length ? jobs[0] : null;
  const updatedMs = latest ? Date.parse(latest.updated_at || latest.created_at || '') || 0 : 0;
  const ageMs = updatedMs ? Math.max(0, now - updatedMs) : null;
  const sectionIndex = Number(latest?.section_index || 0);
  const sectionCount = Number(latest?.section_count || 0) || 0;
  const sectionLabel =
    latest && sectionCount > 0
      ? `section ${Math.min(sectionIndex + 1, sectionCount)}/${sectionCount}`
      : null;

  if (episode?.audio_url && ['preview_ready', 'approved', 'scheduled', 'published'].includes(episode.status)) {
    return {
      state: 'done',
      label: 'Audio ready',
      detail: 'Master audio is available. Listen before Approve / Publish.',
      sectionLabel,
      ageMs,
      job: latest,
      live: false,
    };
  }

  if (latest?.status === 'complete' && episode?.audio_url) {
    return {
      state: 'done',
      label: 'Audio ready',
      detail: 'Latest generation job completed.',
      sectionLabel,
      ageMs,
      job: latest,
      live: false,
    };
  }

  if (latest?.status === 'failed' || episode?.status === 'failed') {
    return {
      state: 'failed',
      label: 'Audio generation failed',
      detail: latest?.error_detail || episode?.last_error || 'Reset stuck audio, then generate preview again.',
      sectionLabel,
      ageMs,
      job: latest,
      live: false,
    };
  }

  const jobRunning = latest?.status === 'running' || latest?.status === 'queued';
  const episodeGenerating = episode?.status === 'generating_audio';

  if (jobRunning || episodeGenerating) {
    if (updatedMs && ageMs != null && ageMs <= liveWithinMs) {
      return {
        state: 'live',
        label: 'Audio generation is LIVE',
        detail: sectionLabel
          ? `Server heartbeat is fresh. Currently on ${sectionLabel}. Keep waiting — do not click Generate again.`
          : 'Server heartbeat is fresh. Keep waiting — do not click Generate again.',
        sectionLabel,
        ageMs,
        job: latest,
        live: true,
      };
    }
    if (!updatedMs || ageMs == null || ageMs >= staleAfterMs) {
      return {
        state: 'stalled',
        label: 'Audio generation looks DEAD',
        detail:
          'No fresh heartbeat from the server (likely 503 / redeploy / timeout). Click Reset stuck audio, then Generate private preview once.',
        sectionLabel,
        ageMs,
        job: latest,
        live: false,
      };
    }
    return {
      state: 'uncertain',
      label: 'Checking audio generation…',
      detail: `Last heartbeat ${Math.round((ageMs || 0) / 1000)}s ago. Waiting to confirm if still live.`,
      sectionLabel,
      ageMs,
      job: latest,
      live: false,
    };
  }

  return {
    state: 'idle',
    label: 'No audio generation in progress',
    detail: episode?.audio_url
      ? 'Audio exists. Generate again only if you need a new preview (includes intro).'
      : 'Click Generate private preview when the full script is ready.',
    sectionLabel: null,
    ageMs: null,
    job: latest,
    live: false,
  };
}

module.exports = { describeAudioProgress };
