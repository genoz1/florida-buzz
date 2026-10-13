#!/usr/bin/env node
'use strict';

/**
 * Lightweight Facebook feed drain.
 *
 * Does not write new articles. Posts at most one queued article/guide
 * (articles.fb_posted=false) when the cadence gap has elapsed. Scheduled
 * frequently enough that a normal day's volume can all reach Facebook the
 * same day without dumping several posts in under an hour.
 *
 * Usage:
 *   DRY_RUN=true node scripts/facebook-feed-drain.js
 *   node scripts/facebook-feed-drain.js
 */

require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { postToFacebookPage } = require('../lib/facebook');
const { toFacebookFeedCaption } = require('../lib/socialCopy');
const {
  decideFacebookDistribution,
  getFacebookCadenceConfig,
} = require('../lib/facebookDistribution');
const {
  applyFacebookFeedDecision,
  loadPendingFacebookFeedPosts,
  markFacebookFeedResolved,
} = require('../lib/facebookFeedQueue');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';

async function run() {
  console.log(`=== Facebook feed drain — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be posted.\n');

  const cadence = getFacebookCadenceConfig();
  // Drain stays lightweight: one post per tick even when automate may post many.
  const perDrain = cadence.maxPostsPerRun > 0 ? cadence.maxPostsPerRun : 1;
  const runCapLabel = cadence.maxPostsPerRun > 0 ? `${cadence.maxPostsPerRun}/run` : '1/drain tick';
  console.log(
    `Cadence: max ${runCapLabel}, ≥${cadence.minHoursBetweenPosts}h apart, `
    + (cadence.maxPostsPerDay > 0 ? `${cadence.maxPostsPerDay}/day cap` : 'no daily hard cap')
    + '. Queue keeps items until posted (spacing deferrals only).\n'
  );

  if (!supabase) {
    console.error('[error] Supabase not configured — cannot load the Facebook feed queue.');
    process.exit(1);
  }

  const queued = await loadPendingFacebookFeedPosts(supabase, {
    limit: perDrain,
    dryRun: DRY_RUN,
  });
  if (!queued.length) {
    console.log('Facebook feed queue empty — nothing to post.');
    return { posted: 0, deferred: 0, skipped: 0 };
  }

  console.log(`Queue: ${queued.length} item(s) waiting.`);
  let posted = 0;
  let deferred = 0;
  let skipped = 0;

  for (const row of queued) {
    if (posted >= perDrain) break;

    const decision = await decideFacebookDistribution(
      {
        category: row.category,
        title: row.title,
        dek: row.dek,
        caption: row.fb_caption,
        slug: row.slug,
      },
      { client: supabase, postsThisRun: posted }
    );
    const gate = await applyFacebookFeedDecision(supabase, row.slug, decision, { dryRun: DRY_RUN });
    if (gate.action === 'skipped') {
      skipped += 1;
      continue;
    }
    if (gate.action !== 'post') {
      deferred += 1;
      // Spacing / max-per-run — stop; later slots will pick this up.
      break;
    }

    const linkKind = row.is_evergreen ? 'guide' : 'article';
    const fbOk = await postToFacebookPage({
      message: toFacebookFeedCaption(row.fb_caption),
      link: `${SITE_URL}/article/${row.slug}`,
      imageUrl: row.image_url,
      dryRun: DRY_RUN,
      linkPlacement: 'first_comment',
      linkCommentKind: linkKind,
    });
    if (fbOk === false) {
      console.error(`  [error] Facebook API failed for ${row.slug} — left queued.`);
      break;
    }

    await markFacebookFeedResolved(supabase, row.slug, { dryRun: DRY_RUN });
    posted += 1;
    console.log(`  Posted to Facebook: ${row.slug}`);
  }

  console.log(`\nDrain result: posted=${posted} deferred=${deferred} skipped=${skipped}`);
  console.log('=== Drain complete ===');
  return { posted, deferred, skipped };
}

if (require.main === module) {
  run().catch((err) => {
    console.error(`[error] Facebook feed drain failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
