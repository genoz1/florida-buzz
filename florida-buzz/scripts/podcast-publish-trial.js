#!/usr/bin/env node
'use strict';

/**
 * End-to-end Florida Buzz podcast trial: draft → TTS → approve → publish once.
 * Florida Buzz Supabase only. Requires OPENAI_API_KEY, FAL_KEY, and
 * PODCASTS_GENERATION_ENABLED=true for this process.
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../lib/podcasts/config');
const { createStore } = require('../lib/podcasts/store');
const { createWeeklyDraft } = require('../lib/podcasts/weeklyDraft');
const { createAudioPipeline } = require('../lib/podcasts/audioPipeline');
const { createFalTts } = require('../lib/podcasts/falTts');
const { DISNEY_SHOW_SLUG } = require('../lib/podcasts/config');

const FB_URL = process.env.FLORIDA_BUZZ_SUPABASE_URL || process.env.SUPABASE_URL;
const FB_KEY = process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ROOK_REF = 'nazycunakcwfmusmiybd';
const RSS_URL = 'https://thefloridabuzz.com/podcasts/florida-buzz-disney/rss.xml';

function assertFbOnly(url) {
  if (!url || !url.includes('tcrfirzjcjvfmiepgbjh')) {
    throw new Error(`Refusing non-Florida-Buzz Supabase URL: ${url}`);
  }
  if (url.includes(ROOK_REF)) throw new Error('Refusing ROOK Supabase project');
}

async function fetchRss() {
  const res = await fetch(`${RSS_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  const xml = await res.text();
  const guids = [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
  return { status: res.status, xml, guids };
}

async function main() {
  const report = {
    started_at: new Date().toISOString(),
    before: null,
    draft: null,
    published: null,
    after: null,
    warnings: [],
  };

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required for real publish trial');
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY required for real publish trial');

  assertFbOnly(FB_URL);
  if (!FB_KEY) throw new Error('FLORIDA_BUZZ_SUPABASE_SERVICE_KEY required');

  process.env.SUPABASE_URL = FB_URL;
  process.env.SUPABASE_SERVICE_KEY = FB_KEY;
  process.env.SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';
  process.env.PODCASTS_GENERATION_ENABLED = 'true';

  const before = await fetchRss();
  report.before = { status: before.status, guid_count: before.guids.length, guids: before.guids };

  const supabase = createClient(FB_URL, FB_KEY);
  const store = createStore(supabase);
  const cfg = config(process.env);
  if (!cfg.generation) throw new Error('Generation did not enable — check PODCASTS_GENERATION_ENABLED');
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    ffmpegPath: 'ffmpeg',
  });
  const aiText = require('../lib/aiText');

  const weekKey = `publish-trial-${new Date().toISOString().slice(0, 10)}`;
  console.log('[publish-trial] generating draft for', weekKey);

  const result = await createWeeklyDraft({
    store,
    supabase,
    cfg,
    aiText,
    pipeline,
    sendEmail: null,
    env: process.env,
    force: true,
    weekKey,
  });

  if (result.skipped) throw new Error(`Draft skipped: ${result.reason}`);

  let episode = await store.getEpisodeById(result.episode.id);
  report.draft = {
    id: episode.id,
    slug: episode.slug,
    status: episode.status,
    title: episode.title,
    has_script: Boolean(episode.script_text),
    has_audio: Boolean(episode.audio_url),
    audio_url: episode.audio_url,
    audio_bytes: episode.audio_byte_size,
    source_count: (await store.listSources(episode.id)).length,
  };

  if (!episode.script_text) throw new Error('Draft missing script_text — aborting before publish');
  if (!episode.audio_url) {
    // TTS may have been skipped if script failed mid-run; refuse publish without audio.
    throw new Error('Draft missing audio_url — aborting before publish');
  }

  if (episode.status === 'script_ready' || episode.status === 'draft') {
    await store.updateEpisode(episode.id, { status: 'preview_ready' }).catch(async () => {
      if (episode.status === 'draft') await store.setStatus(episode.id, 'script_ready');
      await store.setStatus(episode.id, 'preview_ready').catch(() =>
        store.updateEpisode(episode.id, { status: 'preview_ready' })
      );
    });
  }
  episode = await store.getEpisodeById(episode.id);
  if (episode.status !== 'preview_ready' && episode.status !== 'approved') {
    await store.updateEpisode(episode.id, { status: 'preview_ready' });
  }

  await store.setStatus(episode.id, 'approved');
  await store.setStatus(episode.id, 'published');
  episode = await store.getEpisodeById(episode.id);

  report.published = {
    id: episode.id,
    slug: episode.slug,
    status: episode.status,
    guid: episode.guid,
    published_at: episode.published_at,
    page_url: `https://thefloridabuzz.com/podcasts/${DISNEY_SHOW_SLUG}/${episode.slug}`,
    audio_url: episode.audio_url,
  };

  // Idempotency check: publishing again must not change published_at or duplicate GUID in RSS.
  await store.setStatus(episode.id, 'published');
  const again = await store.getEpisodeById(episode.id);
  if (again.published_at !== episode.published_at) {
    report.warnings.push('published_at changed on second publish transition');
  }

  // Give production a moment if it reads live DB (it does).
  await new Promise((r) => setTimeout(r, 2000));
  const after = await fetchRss();
  const guidCount = after.guids.filter((g) => g === episode.guid).length;
  report.after = {
    status: after.status,
    guid_count: after.guids.length,
    guids: after.guids,
    trial_guid_once: guidCount === 1,
    trial_slug_present: after.xml.includes(episode.slug),
    before_guid_count: before.guids.length,
  };

  if (!report.after.trial_slug_present || !report.after.trial_guid_once) {
    report.warnings.push('Live RSS did not show exactly one copy of the trial episode yet — wait for cache or click Apple Refresh');
  }

  report.finished_at = new Date().toISOString();
  report.rss_feed_url = RSS_URL;
  report.apple_refresh_hint = 'In Podcasts Connect → Show Information → Refresh';
  report.spotify_note = 'Spotify usually pulls the new episode automatically within hours';

  const outPath = path.join('/opt/cursor/artifacts', 'florida-buzz-publish-trial-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Wrote', outPath);
}

main().catch((err) => {
  console.error('[podcast-publish-trial] failed:', err);
  process.exitCode = 1;
});
