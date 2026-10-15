'use strict';

/**
 * Durable Facebook feed deferral using articles.fb_posted.
 *
 * Articles and guides that fail cadence stay fb_posted=false and are posted on
 * a later automate/guide/drain run once the minimum spacing has elapsed.
 * When an optional topic filter is on, non-matching topics mark fb_posted=true
 * so they never sit in this queue.
 */

const { isFacebookTopicAllowed } = require('./facebookDistribution');
const { isUsableArticleImage } = require('./articleImages');

async function markFacebookFeedResolved(client, slug, { dryRun = false, logger = console } = {}) {
  if (!client || !slug || dryRun) return true;
  const { error } = await client
    .from('articles')
    .update({ fb_posted: true })
    .eq('slug', slug);
  if (error) {
    logger.error(`  [warn] Could not mark Facebook feed resolved for ${slug}: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Oldest unpublished Facebook-feed candidates (fb_posted=false).
 * Cadence is checked by the caller. Topic filtering is optional (off by default).
 */
async function loadPendingFacebookFeedPosts(client, {
  limit = 20,
  env = process.env,
  dryRun = false,
  logger = console,
} = {}) {
  if (!client || dryRun) return [];
  const { data, error } = await client
    .from('articles')
    .select('slug, title, dek, fb_caption, category, image_url, is_evergreen, published_at')
    .eq('fb_posted', false)
    .order('published_at', { ascending: true })
    .limit(Math.max(limit * 3, 20));
  if (error) {
    logger.error(`  [warn] Could not load Facebook feed queue: ${error.message}`);
    return [];
  }

  const pending = [];
  for (const row of data || []) {
    if (!isUsableArticleImage(row.image_url)) {
      // Keep fb_posted=false so the story can post once a real image lands.
      logger.log(`  [defer] Facebook: ${row.slug} waiting for a usable story image`);
      continue;
    }
    const topic = isFacebookTopicAllowed({
      category: row.category,
      title: row.title,
      dek: row.dek,
      caption: row.fb_caption,
      slug: row.slug,
    }, env);
    if (!topic.ok) {
      // Optional topic filter rejected this row — resolve so it stops clogging the queue.
      await markFacebookFeedResolved(client, row.slug, { logger });
      continue;
    }
    pending.push({ ...row, topic });
    if (pending.length >= limit) break;
  }
  return pending;
}

function isFacebookCadenceDeferral(reason) {
  return reason === 'max_per_run'
    || reason === 'max_per_day'
    || reason === 'min_spacing';
}

/**
 * After decideFacebookDistribution: post | skip (topic) | defer (cadence).
 * Topic skips mark fb_posted=true. Cadence deferrals leave the row queued.
 */
async function applyFacebookFeedDecision(client, slug, decision, {
  dryRun = false,
  logger = console,
} = {}) {
  if (decision?.ok) {
    return { action: 'post' };
  }

  const reason = decision?.reason || 'unknown';
  const detail = decision?.detail ? ` — ${decision.detail}` : '';

  // Permanent skips — clear from the drain queue so July content cannot
  // resurface months later.
  if (
    reason === 'topic_filtered' ||
    reason === 'seasonal_mismatch' ||
    reason === 'stale_news'
  ) {
    await markFacebookFeedResolved(client, slug, { dryRun, logger });
    logger.log(`  [skip] Facebook: ${reason}${detail}`);
    return { action: 'skipped', reason };
  }

  // Cadence (and any other soft block): keep fb_posted=false so a later run posts it.
  logger.log(`  [defer] Facebook: queued for later (${reason})${detail}`);
  return { action: 'deferred', reason };
}

module.exports = {
  applyFacebookFeedDecision,
  isFacebookCadenceDeferral,
  loadPendingFacebookFeedPosts,
  markFacebookFeedResolved,
};
