'use strict';

/**
 * Facebook feed distribution policy for Florida Buzz.
 *
 * Website / other social channels are unchanged. This module only decides
 * whether a piece of content may be posted to the Facebook Page:
 *
 * 1. Topic allowlist — theme parks + cruises (category and/or keywords)
 * 2. Cadence — hours between posts, max posts per run, max posts per day
 *
 * Env overrides (all optional):
 *   FB_TOPIC_FILTER_ENABLED=false     disable topic filter (not recommended)
 *   FB_ALLOWED_CATEGORIES=theme-parks,cruises
 *   FB_MIN_HOURS_BETWEEN_POSTS=3      default 3 (spread posts through the day)
 *   FB_MAX_POSTS_PER_DAY=0            default 0 = no daily hard cap (queue/spacing only)
 *   FB_MAX_POSTS_PER_RUN=1            default 1 (extras stay queued for later runs)
 *   FB_POST_DELAY_MINUTES=60          within-run wait after an FB post (default 60)
 *   FB_SKIP_NON_PARK_FEED=false       allow promo/engagement/city FB again
 *
 * Cadence never permanently drops park/cruise articles or guides. When spacing
 * (or max-per-run) blocks a post, articles.fb_posted stays false and a later
 * automate/guide run posts it. Only non-park topics are skipped for Facebook.
 */

const DEFAULT_ALLOWED_CATEGORIES = ['theme-parks', 'cruises'];

/** Keywords that qualify content even when category is something else (e.g. food). */
const PARK_CRUISE_KEYWORDS = [
  // Disney / WDW
  'disney',
  'walt disney',
  'disney world',
  'magic kingdom',
  'epcot',
  'hollywood studios',
  'hollywood hollywood',
  'animal kingdom',
  'disney springs',
  'lightning lane',
  'genie+',
  'genie plus',
  'park hopper',
  'disney cruise',
  'disney vacation club',
  'wdw',
  // Universal
  'universal orlando',
  'universal studios',
  'islands of adventure',
  'epic universe',
  'universal express',
  'citywalk',
  // Other FL parks often grouped with theme-park coverage
  'seaworld',
  'legoland',
  'busch gardens',
  'theme park',
  'theme parks',
  // Cruises
  'cruise',
  'cruises',
  'cruise line',
  'cruise ship',
  'port canaveral',
  'carnival cruise',
  'royal caribbean',
  'norwegian cruise',
  'msc cruise',
  'celebrity cruise',
];

function parseList(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return [...fallback];
  const items = String(raw)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? items : [...fallback];
}

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positiveInt(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function topicFilterEnabled(env = process.env) {
  return env.FB_TOPIC_FILTER_ENABLED !== 'false';
}

function skipNonParkFeedPosts(env = process.env) {
  // Default ON: promo / engagement / city roundups do not hit Facebook while
  // the Page focuses on park + cruise discovery.
  return env.FB_SKIP_NON_PARK_FEED !== 'false';
}

function getFacebookCadenceConfig(env = process.env) {
  return {
    // Prefer hours-apart spacing over a tight daily cap so every park/cruise
    // article and guide still reaches Facebook — just not in a burst.
    minHoursBetweenPosts: positiveNumber(env.FB_MIN_HOURS_BETWEEN_POSTS, 3),
    // 0 = unlimited (default). A positive value is a soft ceiling for the day;
    // blocked park/cruise items remain queued (fb_posted=false) for later runs.
    maxPostsPerDay: positiveInt(env.FB_MAX_POSTS_PER_DAY, 0),
    maxPostsPerRun: positiveInt(env.FB_MAX_POSTS_PER_RUN, 1),
    // Raised from the old automate.js default of 10 minutes — only used when
    // more than one Facebook post is allowed in a single run.
    postDelayMinutes: positiveInt(env.FB_POST_DELAY_MINUTES, 60),
  };
}

function allowedCategories(env = process.env) {
  return parseList(env.FB_ALLOWED_CATEGORIES, DEFAULT_ALLOWED_CATEGORIES);
}

function normalizeCategory(category) {
  return String(category || '').trim().toLowerCase();
}

function haystackFromContent({ title, dek, caption, bodyText, slug } = {}) {
  return [title, dek, caption, bodyText, slug]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchParkCruiseKeyword(text) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  return PARK_CRUISE_KEYWORDS.find((keyword) => hay.includes(keyword)) || null;
}

/**
 * @returns {{ ok: boolean, reason: string, matched?: string, detail?: string }}
 */
function isFacebookTopicAllowed(content = {}, env = process.env) {
  if (!topicFilterEnabled(env)) {
    return { ok: true, reason: 'filter_disabled' };
  }

  const category = normalizeCategory(content.category);
  const cats = allowedCategories(env);
  if (category && cats.includes(category)) {
    return { ok: true, reason: 'category', matched: category };
  }

  const matched = matchParkCruiseKeyword(haystackFromContent(content));
  if (matched) {
    return { ok: true, reason: 'keyword', matched };
  }

  return {
    ok: false,
    reason: 'topic_filtered',
    detail: `Not theme-park/cruise (category=${category || 'none'})`,
  };
}

/**
 * Whether promo / engagement / city-roundup style jobs should post to Facebook.
 */
function isNonArticleFacebookAllowed(env = process.env) {
  if (!skipNonParkFeedPosts(env)) {
    return { ok: true, reason: 'non_park_feed_allowed' };
  }
  return {
    ok: false,
    reason: 'non_park_feed_skipped',
    detail: 'FB_SKIP_NON_PARK_FEED is on — only park/cruise article & guide posts (plus Reels) go to Facebook',
  };
}

/**
 * Cadence check using in-run counters + optional post_log history.
 *
 * @param {{ postsThisRun?: number, recentSuccesses?: Array<{ created_at: string }>, now?: Date }} state
 */
function evaluateFacebookCadence(state = {}, env = process.env) {
  const config = getFacebookCadenceConfig(env);
  const now = state.now instanceof Date ? state.now : new Date();
  const postsThisRun = Number(state.postsThisRun) || 0;
  const recent = Array.isArray(state.recentSuccesses) ? state.recentSuccesses : [];

  if (postsThisRun >= config.maxPostsPerRun) {
    return {
      ok: false,
      reason: 'max_per_run',
      detail: `Already posted ${postsThisRun} Facebook item(s) this run (max ${config.maxPostsPerRun})`,
      config,
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const postsToday = recent.filter((row) => {
    const t = new Date(row.created_at).getTime();
    return Number.isFinite(t) && now.getTime() - t < dayMs;
  }).length;

  // maxPostsPerDay === 0 means no daily hard cap (spacing + max-per-run only).
  if (config.maxPostsPerDay > 0 && postsToday >= config.maxPostsPerDay) {
    return {
      ok: false,
      reason: 'max_per_day',
      detail: `Already ${postsToday} Facebook success(es) in the last 24h (max ${config.maxPostsPerDay}); park/cruise items stay queued`,
      config,
    };
  }

  if (config.minHoursBetweenPosts > 0 && recent.length) {
    const latest = recent
      .map((row) => new Date(row.created_at).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];
    if (latest != null) {
      const hoursSince = (now.getTime() - latest) / (60 * 60 * 1000);
      if (hoursSince < config.minHoursBetweenPosts) {
        return {
          ok: false,
          reason: 'min_spacing',
          detail: `Only ${hoursSince.toFixed(2)}h since last Facebook post (need ${config.minHoursBetweenPosts}h)`,
          config,
          hoursSince,
        };
      }
    }
  }

  return { ok: true, reason: 'cadence_ok', config, postsToday, postsThisRun };
}

/**
 * Load recent successful Facebook posts from post_log (best-effort).
 */
async function loadRecentFacebookSuccesses(client, { limit = 50 } = {}) {
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('post_log')
      .select('created_at, detail')
      .eq('platform', 'facebook')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error(`  [warn] Could not load Facebook post_log for cadence: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error(`  [warn] Facebook cadence history unavailable: ${err.message}`);
    return [];
  }
}

/**
 * Full decide path for article/guide Facebook posts.
 *
 * @returns {Promise<{ ok: boolean, reason: string, detail?: string, topic?: object, cadence?: object }>}
 */
async function decideFacebookDistribution(content, {
  client = null,
  postsThisRun = 0,
  now = new Date(),
  recentSuccesses = null,
  env = process.env,
} = {}) {
  const topic = isFacebookTopicAllowed(content, env);
  if (!topic.ok) {
    return { ok: false, reason: topic.reason, detail: topic.detail, topic };
  }

  const history = recentSuccesses != null
    ? recentSuccesses
    : await loadRecentFacebookSuccesses(client);
  const cadence = evaluateFacebookCadence({ postsThisRun, recentSuccesses: history, now }, env);
  if (!cadence.ok) {
    return { ok: false, reason: cadence.reason, detail: cadence.detail, topic, cadence };
  }

  return {
    ok: true,
    reason: 'allowed',
    topic,
    cadence,
    detail: `topic=${topic.reason}${topic.matched ? `:${topic.matched}` : ''}`,
  };
}

module.exports = {
  DEFAULT_ALLOWED_CATEGORIES,
  PARK_CRUISE_KEYWORDS,
  allowedCategories,
  decideFacebookDistribution,
  evaluateFacebookCadence,
  getFacebookCadenceConfig,
  isFacebookTopicAllowed,
  isNonArticleFacebookAllowed,
  loadRecentFacebookSuccesses,
  matchParkCruiseKeyword,
  skipNonParkFeedPosts,
  topicFilterEnabled,
};
