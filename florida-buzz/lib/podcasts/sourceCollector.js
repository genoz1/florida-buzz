'use strict';

const { windowStartIso } = require('./timeEt');
const { pickEvergreenTopic } = require('./evergreenTopics');

const DISNEY_RE =
  /\b(disney|walt disney world|magic kingdom|epcot|hollywood studios|animal kingdom|disney springs|genie\+|lightning lane|disney resort|monorail|skyliner)\b/i;

const NON_DISNEY_PARK_RE = /\b(universal orlando|epic universe|islands of adventure|universal studios|legoland|seaworld)\b/i;

function siteBase(env = process.env) {
  return (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
}

function articleUrl(site, article) {
  return `${site}/article/${article.slug}`;
}

function isDisneyArticle(article) {
  const hay = `${article.title || ''} ${article.dek || ''} ${article.source_name || ''} ${article.slug || ''}`;
  if (NON_DISNEY_PARK_RE.test(hay) && !DISNEY_RE.test(hay)) return false;
  return DISNEY_RE.test(hay);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function paraphraseQuestion(question) {
  const text = String(question || '').trim().replace(/\s+/g, ' ');
  if (!text) return text;
  // Keep meaning; avoid copying usernames/emails if somehow embedded.
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[phone removed]')
    .slice(0, 280);
}

async function collectWeeklyArticles(supabase, { sinceIso, site, limit = 12 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, dek, category, source_name, published_at, is_evergreen, body_html')
    .eq('category', 'theme-parks')
    .eq('is_evergreen', false)
    .gte('published_at', sinceIso)
    .order('published_at', { ascending: false })
    .limit(40);
  if (error) throw new Error(`article collect failed: ${error.message}`);
  return (data || [])
    .filter(isDisneyArticle)
    .slice(0, limit)
    .map((article, index) => ({
      source_kind: 'article',
      title: article.title,
      url: articleUrl(site, article),
      summary: stripHtml(article.dek || '').slice(0, 500) || null,
      included: true,
      sort_order: index,
      external_ref: article.id,
      meta: {
        published_at: article.published_at,
        source_name: article.source_name,
        slug: article.slug,
      },
    }));
}

async function collectEvergreenGuides(supabase, { site, limit = 4, excludeIds = [] } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, dek, category, published_at, is_evergreen')
    .eq('category', 'theme-parks')
    .eq('is_evergreen', true)
    .order('published_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(`guide collect failed: ${error.message}`);
  const excluded = new Set(excludeIds);
  return (data || [])
    .filter((g) => !excluded.has(g.id))
    .filter(isDisneyArticle)
    .slice(0, limit)
    .map((guide, index) => ({
      source_kind: 'guide',
      title: guide.title,
      url: articleUrl(site, guide),
      summary: stripHtml(guide.dek || '').slice(0, 500) || 'Evergreen Florida Buzz Disney planning guide.',
      included: true,
      sort_order: 100 + index,
      external_ref: guide.id,
      meta: { slug: guide.slug, is_evergreen: true },
    }));
}

async function collectBuzzBoardQuestions(supabase, { site, limit = 3 } = {}) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc('get_buzz_board_feed', {
      p_filter: 'disney',
      p_limit: Math.min(50, Math.max(limit * 4, 12)),
      p_offset: 0,
    });
    if (error) throw error;
    return (data || [])
      .filter((row) => row && row.slug && row.question && (row.status === 'published' || !row.status))
      .slice(0, limit)
      .map((row, index) => ({
        source_kind: 'buzz_board',
        title: paraphraseQuestion(row.question),
        url: `${site}/buzz/${row.slug}`,
        summary: row.context ? paraphraseQuestion(stripHtml(row.context)).slice(0, 400) : null,
        included: true,
        sort_order: 200 + index,
        external_ref: row.id || row.slug,
        meta: {
          slug: row.slug,
          topic: row.topic || null,
          category: row.category || 'disney',
          // Never store usernames, votes, or response bodies from the community.
          public_question_only: true,
        },
      }));
  } catch (err) {
    console.warn('[podcasts] buzz board collect skipped:', err.message);
    return [];
  }
}

/**
 * Content priority:
 * 1) current week Disney articles
 * 2) evergreen guides (if articles thin)
 * 3) 2–3 Buzz Board public questions
 * 4) one evergreen opinion/planning topic
 * Always returns a usable set even when articles are scarce.
 */
async function collectWeeklySources(supabase, { weekKey, env = process.env, now = new Date() } = {}) {
  const site = siteBase(env);
  const sinceIso = windowStartIso(7, now);
  const articles = await collectWeeklyArticles(supabase, { sinceIso, site, limit: 12 });
  const needGuides = articles.length < 4 ? 4 : articles.length < 7 ? 2 : 1;
  const guides = await collectEvergreenGuides(supabase, {
    site,
    limit: needGuides,
    excludeIds: articles.map((a) => a.external_ref),
  });
  const buzz = await collectBuzzBoardQuestions(supabase, { site, limit: 3 });
  const evergreen = pickEvergreenTopic([], weekKey);
  const evergreenSource = {
    source_kind: 'evergreen_topic',
    title: evergreen.title,
    url: `${site}/guides`,
    summary: evergreen.summary,
    included: true,
    sort_order: 300,
    external_ref: evergreen.slug,
    meta: { topic_slug: evergreen.slug, composite: true },
  };

  const sources = [...articles, ...guides, ...buzz, evergreenSource];
  return {
    sinceIso,
    site,
    counts: {
      articles: articles.length,
      guides: guides.length,
      buzz_board: buzz.length,
      evergreen_topics: 1,
      total: sources.length,
    },
    sources,
  };
}

module.exports = {
  DISNEY_RE,
  isDisneyArticle,
  paraphraseQuestion,
  collectWeeklyArticles,
  collectEvergreenGuides,
  collectBuzzBoardQuestions,
  collectWeeklySources,
};
