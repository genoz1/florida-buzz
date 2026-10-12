#!/usr/bin/env node
'use strict';

/**
 * One Disney/theme-park (or cruise) Reel for Facebook discovery.
 *
 * Cheap path: article still → slow zoom/pan + big on-screen text → optional Page video.
 * Does NOT use fal Seedance / guide-reels / AI presenters.
 *
 * Usage:
 *   DRY_RUN=true node scripts/facebook-park-reel.js
 *   FB_PARK_REEL_PUBLISH=true FB_PARK_REEL_MODE=tip node scripts/facebook-park-reel.js
 *   FB_PARK_REEL_PUBLISH=true FB_PARK_REEL_MODE=disney-news node scripts/facebook-park-reel.js
 *
 * Publish requires the rendered MP4 to be reachable (Supabase public URL preferred).
 *
 * Daily schedule (server.js):
 *   10:30am ET → FB_PARK_REEL_MODE=tip (guides / tips & tricks)
 *   7:00pm ET  → FB_PARK_REEL_MODE=disney-news
 * Missed slots catch up on startup and at 2pm/8pm ET.
 */

require('dotenv').config();
const { supabase } = require('../lib/supabase');
const {
  normalizeParkReelMode,
  runParkReelJob,
} = require('../lib/facebookParkReel');

async function main() {
  const mode = normalizeParkReelMode(process.env.FB_PARK_REEL_MODE || 'tip');
  console.log(`=== Facebook park Reel [${mode}] — ${new Date().toISOString()} ===`);
  if (!supabase) {
    console.error('[error] Supabase not configured — cannot pick an article.');
    process.exit(1);
  }

  const result = await runParkReelJob({
    client: supabase,
    dryRun: process.env.DRY_RUN === 'true',
    publish: process.env.FB_PARK_REEL_PUBLISH === 'true',
    mode,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.reason === 'no_candidate') process.exitCode = 1;
  console.log('\n=== Run complete ===');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error in facebook-park-reel:', err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
