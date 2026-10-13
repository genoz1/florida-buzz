'use strict';

/**
 * Facebook feed distribution policy for Florida Buzz.
 *
 * Website / other social channels are unchanged. This module decides whether
 * a piece of content may be posted to the Facebook Page:
 *
 * 1. Topic filter — OFF by default (every article & guide can post). Optional
 *    park/cruise allowlist remains available via FB_TOPIC_FILTER_ENABLED=true.
 * 2. Cadence — hours between posts, max posts per run, max posts per day
 *
 * Env overrides (all optional):
 *   FB_TOPIC_FILTER_ENABLED=true      enable park/cruise-only allowlist
 *   FB_ALLOWED_CATEGORIES=theme-parks,cruises
 *   FB_MIN_HOURS_BETWEEN_POSTS=0.25   default 0.25 (~15 min; matches pre-filter
 *                                     FB_POST_DELAY_MINUTES production spacing)
 *   FB_MAX_POSTS_PER_DAY=0            default 0 = no daily hard cap (queue/spacing only)
 *   FB_MAX_POSTS_PER_RUN=0            default 0 = no per-run cap (space within the run)
 *   FB_POST_DELAY_MINUTES=15          within-run wait after an FB post (default 15)
 *   FB_SKIP_NON_PARK_FEED=true        skip promo/engagement/city FB posts
 *
 * Cadence never permanently drops article/guide rows. When spacing blocks a
 * post, articles.fb_posted stays false and a later automate/guide/drain run
 * posts it.
 *
 * Throughput math (defaults): ≥15 min gap. A 45-post day clears in ~11h of
 * spaced posting (same idea as the old within-run 10–15 minute delay).
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

/** Feed topic filter is opt-in — default posts every article/guide. */
function topicFilterEnabled(env = process.env) {
  return env.FB_TOPIC_FILTER_ENABLED === 'true';
}

/** Non-article feed jobs (promo/engagement/city) post unless explicitly skipped. */
function skipNonParkFeedPosts(env = process.env) {
  return env.FB_SKIP_NON_PARK_FEED === 'true';
}

function getFacebookCadenceConfig(env = process.env) {
  return {
    // ~15 minutes — same spacing the site used before the park/cruise filter
    // (code default was 10; production FB_POST_DELAY_MINUTES was 15).
    minHoursBetweenPosts: positiveNumber(env.FB_MIN_HOURS_BETWEEN_POSTS, 0.25),
    // 0 = unlimited (default). A positive value is a soft ceiling for the day;
    // blocked items remain queued (fb_posted=false) for later runs.
    maxPostsPerDay: positiveInt(env.FB_MAX_POSTS_PER_DAY, 0),
    // 0 = unlimited per run (default). Automate/guide can clear a batch with
    // postDelayMinutes between successes, matching the old within-run spacing.
    maxPostsPerRun: positiveInt(env.FB_MAX_POSTS_PER_RUN, 0),
    // Within-run wait after each Facebook success when posting more than one.
    postDelayMinutes: positiveInt(env.FB_POST_DELAY_MINUTES, 15),
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
 * Always apply the park/cruise allowlist (used by Reels topic picking).
 * Independent of the feed-level FB_TOPIC_FILTER_ENABLED flag.
 */
function isParkCruiseTopic(content = {}, env = process.env) {
  return isFacebookTopicAllowed(content, { ...env, FB_TOPIC_FILTER_ENABLED: 'true' });
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
    detail: 'FB_SKIP_NON_PARK_FEED is on — promo/engagement/city Facebook posts are skipped',
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

  // maxPostsPerRun === 0 means no per-run cap (within-run delay + min spacing only).
  if (config.maxPostsPerRun > 0 && postsThisRun >= config.maxPostsPerRun) {
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
      detail: `Already ${postsToday} Facebook success(es) in the last 24h (max ${config.maxPostsPerDay}); items stay queued`,
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
 * Max age (days) for non-evergreen news on the Facebook drain queue.
 * Older rows are permanently skipped (fb_posted=true) so July stories
 * cannot dump onto the Page in October.
 */
function facebookMaxNewsAgeDays(env = process.env) {
  return positiveInt(env.FB_MAX_NEWS_AGE_DAYS, 21);
}

const SEASONAL_WINDOWS = Object.freeze([
  {
    name: 'independence_day',
    // Mid-June through mid-July only
    months: [6, 7],
    // In July allow through day 15; in June from day 15
    re: /\b(independence day|fourth of july|4th of july|july\s*4(?:th)?|july fourth)\b/i,
  },
  {
    name: 'june_festival',
    months: [6],
    re: /\bjune (?:festival|festivals|events?)\b/i,
  },
]);

/**
 * Reject dated/seasonal captions that are out of season, and reject stale
 * non-evergreen news older than FB_MAX_NEWS_AGE_DAYS (default 21).
 *
 * @returns {{ ok: boolean, reason: string, detail?: string }}
 */
function isFacebookContentFresh(content = {}, env = process.env, now = new Date()) {
  const hay = haystackFromContent(content);
  const month = now.getUTCMonth() + 1; // 1-12
  const day = now.getUTCDate();

  for (const window of SEASONAL_WINDOWS) {
    if (!window.re.test(hay)) continue;
    let inSeason = window.months.includes(month);
    if (window.name === 'independence_day') {
      inSeason =
        (month === 6 && day >= 15) || (month === 7 && day <= 15);
    }
    if (!inSeason) {
      return {
        ok: false,
        reason: 'seasonal_mismatch',
        detail: `Seasonal “${window.name}” content blocked in ${month}/${day}`,
      };
    }
  }

  const publishedAt = content.publishedAt || content.published_at;
  const isEvergreen = content.isEvergreen === true || content.is_evergreen === true;
  if (!isEvergreen && publishedAt) {
    const published = new Date(publishedAt);
    if (Number.isFinite(published.getTime())) {
      const ageDays = (now.getTime() - published.getTime()) / (24 * 60 * 60 * 1000);
      const maxAge = facebookMaxNewsAgeDays(env);
      if (maxAge > 0 && ageDays > maxAge) {
        return {
          ok: false,
          reason: 'stale_news',
          detail: `News is ${ageDays.toFixed(0)}d old (max ${maxAge}d for Facebook)`,
        };
      }
    }
  }

  return { ok: true, reason: 'fresh' };
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

  const fresh = isFacebookContentFresh(content, env, now instanceof Date ? now : new Date());
  if (!fresh.ok) {
    return { ok: false, reason: fresh.reason, detail: fresh.detail, topic, fresh };
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
  facebookMaxNewsAgeDays,
  getFacebookCadenceConfig,
  isFacebookContentFresh,
  isFacebookTopicAllowed,
  isNonArticleFacebookAllowed,
  isParkCruiseTopic,
  loadRecentFacebookSuccesses,
  matchParkCruiseKeyword,
  skipNonParkFeedPosts,
  topicFilterEnabled,
};
