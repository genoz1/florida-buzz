#!/usr/bin/env node
'use strict';

/**
 * Upload Florida Buzz Disney show cover art to podcast-artwork and point
 * podcast_shows (+ episode artwork_url) at the new public URL.
 * Also aligns show hosts/description to solo Geno.
 * Does not touch intro audio or trailer audio masters.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { DISNEY_SHOW_SLUG } = require('../lib/podcasts/config');
const { createStore } = require('../lib/podcasts/store');

const FB_URL = process.env.FLORIDA_BUZZ_SUPABASE_URL || process.env.SUPABASE_URL;
const FB_KEY = process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const COVER_PATH =
  process.env.PODCASTS_COVER_FILE ||
  path.join(__dirname, '../public/img/podcasts/florida-buzz-disney-cover-3000.jpg');
const STORAGE_OBJECT =
  process.env.PODCASTS_COVER_OBJECT ||
  'shows/florida-buzz-disney/florida-buzz-disney-cover-v3-geno-3000.jpg';
const COVER_ALT =
  process.env.PODCASTS_COVER_ALT ||
  'Florida Buzz Disney Podcast cover — hosted by Geno';
const ARTWORK_BUCKET = process.env.PODCASTS_ARTWORK_BUCKET || 'podcast-artwork';

const SHOW_DESCRIPTION =
  'Florida Buzz: Disney is your place for real conversations about Walt Disney World. Hosted by Geno, a lifelong Disney World visitor who first experienced Magic Kingdom at 18 months old, the show brings decades of park perspective to today’s news — new attractions, announcements, prices, restaurants, resorts, and the little things longtime fans notice. Pull up a chair and join the conversation. Presented by TheFloridaBuzz.com.';

async function main() {
  if (!FB_URL || !FB_KEY) throw new Error('Florida Buzz Supabase URL/key required');
  if (!FB_URL.includes('tcrfirzjcjvfmiepgbjh')) {
    throw new Error(`Refusing non-Florida-Buzz Supabase URL: ${FB_URL}`);
  }
  if (!fs.existsSync(COVER_PATH)) throw new Error(`Cover file missing: ${COVER_PATH}`);

  const bytes = fs.readFileSync(COVER_PATH);
  const client = createClient(FB_URL, FB_KEY, { auth: { persistSession: false } });
  const store = createStore(client);
  const show = await store.getShow(DISNEY_SHOW_SLUG);
  if (!show) throw new Error('florida-buzz-disney show missing');

  const contentType = COVER_PATH.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const publicUrl = await store.uploadBytes(ARTWORK_BUCKET, STORAGE_OBJECT, bytes, contentType);

  // Keep legacy filenames in sync so older links and local fallbacks still resolve.
  const legacyNames = [
    'shows/florida-buzz-disney/florida-buzz-disney-cover-3000.jpg',
    'shows/florida-buzz-disney/florida-buzz-disney-cover.jpg',
    'shows/florida-buzz-disney/florida-buzz-disney-cover-v2-3000.jpg',
  ];
  for (const legacy of legacyNames) {
    if (legacy === STORAGE_OBJECT) continue;
    await store.uploadBytes(ARTWORK_BUCKET, legacy, bytes, contentType);
  }

  const updated = await store.updateShow(show.id, {
    cover_url: publicUrl,
    cover_alt: COVER_ALT,
    hosts: [{ name: 'Geno', role: 'host' }],
    description: SHOW_DESCRIPTION,
  });

  const episodes = await store.listEpisodes(show.id);
  const touchStatuses = new Set([
    'draft',
    'script_ready',
    'generating_audio',
    'preview_ready',
    'approved',
    'scheduled',
    'published',
  ]);
  const episodeUpdates = [];
  for (const ep of episodes) {
    if (!touchStatuses.has(ep.status)) continue;
    if (ep.artwork_url === publicUrl && ep.artwork_alt === COVER_ALT) continue;
    if (
      ep.artwork_url == null ||
      String(ep.artwork_url).includes('/podcast-artwork/shows/florida-buzz-disney/')
    ) {
      const row = await checkedUpdate(client, ep.id, {
        artwork_url: publicUrl,
        artwork_alt: COVER_ALT,
      });
      episodeUpdates.push({
        id: ep.id,
        slug: ep.slug,
        status: ep.status,
        artwork_url: row.artwork_url,
        artwork_alt: row.artwork_alt,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        show: updated.slug,
        cover_url: updated.cover_url,
        cover_alt: updated.cover_alt,
        hosts: updated.hosts,
        bytes: bytes.length,
        storage_object: STORAGE_OBJECT,
        episodes_updated: episodeUpdates.length,
        episodes: episodeUpdates.map((e) => ({ slug: e.slug, status: e.status })),
        note: 'Intro audio unchanged. Cover is HOSTED BY GENO (solo).',
      },
      null,
      2
    )
  );
}

async function checkedUpdate(client, episodeId, patch) {
  const { data, error } = await client
    .from('podcast_episodes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', episodeId)
    .select('id, slug, status, artwork_url, artwork_alt')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
