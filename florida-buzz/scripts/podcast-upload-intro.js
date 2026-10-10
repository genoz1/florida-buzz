#!/usr/bin/env node
'use strict';

/**
 * Upload the approved Florida Buzz park intro and attach it to the Disney show.
 * Does not touch the trailer episode master.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { DISNEY_SHOW_SLUG } = require('../lib/podcasts/config');
const { createStore } = require('../lib/podcasts/store');

const FB_URL = process.env.FLORIDA_BUZZ_SUPABASE_URL || process.env.SUPABASE_URL;
const FB_KEY = process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
const INTRO_PATH =
  process.env.PODCASTS_INTRO_FILE ||
  path.join(__dirname, '../public/podcasts/florida-buzz-park-intro-trimmed-v6.mp3');

async function main() {
  if (!FB_URL || !FB_KEY) throw new Error('Florida Buzz Supabase URL/key required');
  if (!FB_URL.includes('tcrfirzjcjvfmiepgbjh')) {
    throw new Error(`Refusing non-Florida-Buzz Supabase URL: ${FB_URL}`);
  }
  if (!fs.existsSync(INTRO_PATH)) throw new Error(`Intro file missing: ${INTRO_PATH}`);

  const bytes = fs.readFileSync(INTRO_PATH);
  const client = createClient(FB_URL, FB_KEY, { auth: { persistSession: false } });
  const store = createStore(client);
  const show = await store.getShow(DISNEY_SHOW_SLUG);
  if (!show) throw new Error('florida-buzz-disney show missing');

  const storagePath = `${show.id}/show-intro-park-trimmed-v6.mp3`;
  const publicUrl = await store.uploadBytes('podcast-audio', storagePath, bytes, 'audio/mpeg');
  const updated = await store.updateShow(show.id, { intro_audio_url: publicUrl });

  console.log(
    JSON.stringify(
      {
        ok: true,
        show: updated.slug,
        intro_audio_url: updated.intro_audio_url,
        bytes: bytes.length,
        note: 'Regenerate episode private preview to prepend this intro. Trailer episode is unchanged.',
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
