require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { postToFacebookPage } = require('../lib/facebook');
const { saveFacebookPostMapping } = require('../lib/facebookBuzz');
const { createPost: createInstagramPost } = require('../lib/instagram');

const CAMPAIGN = 'buzz_board_launch';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';
const DRY_RUN = process.env.DRY_RUN === 'true';
const CATEGORY_ROTATION = ['disney', 'universal', 'disney', 'universal', 'disney', 'cruises', 'disney', 'universal', 'florida-life'];
const FACEBOOK_COOLDOWN_DAYS = 10;
const INSTAGRAM_COOLDOWN_DAYS = 21;
const FACEBOOK_SLOTS = { morning: 0, afternoon: 1, evening: 2 };

function easternDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function selectDailyDiscussion(discussions, now = new Date()) {
  if (!Array.isArray(discussions) || discussions.length === 0) return null;
  const [year, month, day] = easternDateKey(now).split('-').map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  return discussions[dayNumber % discussions.length];
}

function dayNumber(now = new Date()) {
  const [year, month, day] = easternDateKey(now).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function categoryForSlot(platform, slot = 'daily', now = new Date()) {
  const slotIndex = platform === 'facebook' ? (FACEBOOK_SLOTS[slot] ?? 0) : 0;
  const index = platform === 'facebook' ? (dayNumber(now) * 3) + slotIndex : dayNumber(now);
  return CATEGORY_ROTATION[index % CATEGORY_ROTATION.length];
}

function selectSocialDiscussion(discussions, history = [], {
  platform,
  slot = 'daily',
  now = new Date(),
} = {}) {
  if (!Array.isArray(discussions) || discussions.length === 0) return null;
  const cooldownDays = platform === 'instagram' ? INSTAGRAM_COOLDOWN_DAYS : FACEBOOK_COOLDOWN_DAYS;
  const cutoff = now.getTime() - (cooldownDays * 24 * 60 * 60 * 1000);
  const recent = new Set(history
    .filter((row) => new Date(row.created_at).getTime() >= cutoff)
    .map((row) => row.slug));
  const counts = new Map();
  for (const row of history) counts.set(row.slug, (counts.get(row.slug) || 0) + 1);
  const eligible = discussions.filter((discussion) => !recent.has(discussion.slug));
  if (!eligible.length) return null;
  const desiredCategory = categoryForSlot(platform, slot, now);
  const categoryPool = eligible.filter((discussion) => discussion.category === desiredCategory);
  const pool = categoryPool.length ? categoryPool : eligible;
  return [...pool].sort((left, right) => {
    const countDelta = (counts.get(left.slug) || 0) - (counts.get(right.slug) || 0);
    if (countDelta) return countDelta;
    return String(left.slug).localeCompare(String(right.slug));
  })[dayNumber(now) % pool.length];
}

function buildTrackingUrl(slug, platform, siteUrl = SITE_URL) {
  const url = new URL(`/buzz/${encodeURIComponent(slug)}`, siteUrl);
  url.searchParams.set('utm_source', platform);
  url.searchParams.set('utm_medium', 'organic_social');
  url.searchParams.set('utm_campaign', CAMPAIGN);
  url.searchParams.set('utm_content', slug);
  return url.toString();
}

function buildShortTrackingUrl(slug, siteUrl = SITE_URL) {
  return new URL(`/go/buzz/${encodeURIComponent(slug)}`, siteUrl).toString();
}

function buildFacebookImageUrl(slug, siteUrl = SITE_URL) {
  return new URL(`/images/buzz-board-social/${encodeURIComponent(slug)}.png`, siteUrl).toString();
}

function buildInstagramImageUrl(slug, siteUrl = SITE_URL) {
  return buildFacebookImageUrl(slug, siteUrl);
}

function buildInstagramShortTrackingUrl(slug, siteUrl = SITE_URL) {
  return new URL(`/go/ig/${encodeURIComponent(slug)}`, siteUrl).toString();
}

function buildCopy(discussion, platform, siteUrl = SITE_URL) {
  if (platform === 'instagram') {
    const url = buildInstagramShortTrackingUrl(discussion.slug, siteUrl);
    return `Answer here on Instagram or continue this exact conversation on Buzz Board.\n\nCopy this short address into your browser:\n${url}`;
  }
  return 'Answer here or join the conversation on Buzz Board 👇';
}

function logMarker(platform, slug) {
  return `${CAMPAIGN}:${platform}:${slug}`;
}

async function loadLaunchDiscussions(client) {
  const { data, error } = await client.from('discussions')
    .select('id, slug, question, category, topic, created_at')
    .eq('source_type', 'florida_buzz')
    .eq('status', 'published')
    .eq('moderation_status', 'published')
    .order('created_at', { ascending: true })
    .order('slug', { ascending: true });
  if (error) throw new Error(`Could not load Buzz Board launch discussions: ${error.message}`);
  return data || [];
}

async function wasPosted(client, platform, slug) {
  const { data, error } = await client.from('post_log')
    .select('id')
    .eq('platform', platform)
    .eq('status', 'success')
    .eq('detail', logMarker(platform, slug))
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not verify prior ${platform} Buzz Board post: ${error.message}`);
  return Boolean(data);
}

async function loadPostHistory(client, platform, limit = 500) {
  const { data, error } = await client.from('post_log')
    .select('detail, created_at')
    .eq('platform', platform)
    .eq('status', 'success')
    .like('detail', `${CAMPAIGN}:${platform}:%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load ${platform} Buzz Board history: ${error.message}`);
  return (data || []).map((row) => ({
    slug: String(row.detail || '').split(':').slice(2).join(':'),
    created_at: row.created_at,
  })).filter((row) => row.slug);
}

async function run({
  client = supabase,
  now = new Date(),
  dryRun = DRY_RUN,
  platform = process.env.SOCIAL_PLATFORM || 'both',
  facebookPublisher = postToFacebookPage,
  instagramPublisher = createInstagramPost,
  slot = process.env.BUZZ_SOCIAL_SLOT || 'daily',
} = {}) {
  if (!client) throw new Error('Supabase is required for Buzz Board social distribution.');
  if (!['both', 'facebook', 'instagram'].includes(platform)) {
    throw new Error('SOCIAL_PLATFORM must be both, facebook, or instagram.');
  }

  const discussions = await loadLaunchDiscussions(client);
  const selectionPlatform = platform === 'both' ? 'facebook' : platform;
  const history = dryRun ? [] : await loadPostHistory(client, selectionPlatform);
  const discussion = selectSocialDiscussion(discussions, history, {
    platform: selectionPlatform,
    slot,
    now,
  });
  if (!discussion) {
    const skipped = { discussion: null, facebook: 'cooldown_skip', instagram: 'cooldown_skip' };
    console.log(JSON.stringify(skipped));
    return skipped;
  }

  const instagramImageUrl = buildInstagramImageUrl(discussion.slug);
  const results = { discussion: discussion.slug, facebook: 'not_requested', instagram: 'not_requested' };

  if (platform === 'both' || platform === 'facebook') {
    const publishResult = await facebookPublisher({
      message: buildCopy(discussion, 'facebook'),
      link: buildShortTrackingUrl(discussion.slug),
      imageUrl: buildFacebookImageUrl(discussion.slug),
      dryRun,
      logDetail: logMarker('facebook', discussion.slug),
      returnResult: true,
    });
    if (publishResult && !dryRun) {
      await saveFacebookPostMapping(client, {
        discussionId: discussion.id,
        publishResult,
        publishedAt: now,
      });
    }
    results.facebook = publishResult ? (dryRun ? 'dry_run' : 'posted') : 'failed';
  }

  if (platform === 'both' || platform === 'instagram') {
    if (dryRun) {
      console.log(`[dry-run] Would post to Instagram: "${buildCopy(discussion, 'instagram')}" (image: ${instagramImageUrl})`);
      results.instagram = 'dry_run';
    } else {
      await instagramPublisher({
        imageUrl: instagramImageUrl,
        caption: buildCopy(discussion, 'instagram'),
        logDetail: logMarker('instagram', discussion.slug),
      });
      results.instagram = 'posted';
    }
  }

  console.log(JSON.stringify(results));
  return results;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Buzz Board social run failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CAMPAIGN,
  buildCopy,
  buildFacebookImageUrl,
  buildInstagramImageUrl,
  buildInstagramShortTrackingUrl,
  buildShortTrackingUrl,
  buildTrackingUrl,
  easternDateKey,
  loadLaunchDiscussions,
  logMarker,
  run,
  selectDailyDiscussion,
  selectSocialDiscussion,
  categoryForSlot,
  loadPostHistory,
  CATEGORY_ROTATION,
  FACEBOOK_COOLDOWN_DAYS,
  INSTAGRAM_COOLDOWN_DAYS,
  wasPosted,
};
