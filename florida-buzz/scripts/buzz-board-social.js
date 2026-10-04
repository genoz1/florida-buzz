require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { postToFacebookPage } = require('../lib/facebook');
const { saveFacebookPostMapping } = require('../lib/facebookBuzz');
const { createPost: createInstagramPost } = require('../lib/instagram');

const CAMPAIGN = 'buzz_board_launch';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';
const DRY_RUN = process.env.DRY_RUN === 'true';

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

function buildCopy(discussion, platform, siteUrl = SITE_URL) {
  if (platform === 'instagram') {
    const url = buildTrackingUrl(discussion.slug, platform, siteUrl);
    return `${discussion.question}\n\nFlorida travelers will not all agree on this one. Join the conversation on Buzz Board:\n${url}`;
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

async function run({
  client = supabase,
  now = new Date(),
  dryRun = DRY_RUN,
  platform = process.env.SOCIAL_PLATFORM || 'both',
  facebookPublisher = postToFacebookPage,
  instagramPublisher = createInstagramPost,
} = {}) {
  if (!client) throw new Error('Supabase is required for Buzz Board social distribution.');
  if (!['both', 'facebook', 'instagram'].includes(platform)) {
    throw new Error('SOCIAL_PLATFORM must be both, facebook, or instagram.');
  }

  const discussions = await loadLaunchDiscussions(client);
  const discussion = selectDailyDiscussion(discussions, now);
  if (!discussion) throw new Error('No published Florida Buzz starter discussions are available.');

  const instagramImageUrl = `${SITE_URL}/images/buzz-board-social.png`;
  const results = { discussion: discussion.slug, facebook: 'not_requested', instagram: 'not_requested' };

  if (platform === 'both' || platform === 'facebook') {
    const alreadyPosted = !dryRun && await wasPosted(client, 'facebook', discussion.slug);
    if (alreadyPosted) {
      results.facebook = 'already_posted';
    } else {
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
  }

  if (platform === 'both' || platform === 'instagram') {
    const alreadyPosted = !dryRun && await wasPosted(client, 'instagram', discussion.slug);
    if (alreadyPosted) {
      results.instagram = 'already_posted';
    } else {
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
  buildShortTrackingUrl,
  buildTrackingUrl,
  easternDateKey,
  loadLaunchDiscussions,
  logMarker,
  run,
  selectDailyDiscussion,
  wasPosted,
};
