'use strict';

const { filterRedirectedArticles, isRedirectedArticleSlug } = require('./articleRedirects');

const DEFAULT_RETRY_DELAY_MS = 800;
const DEFAULT_MAX_RETRIES = 1;
const PAGE_BATCH_SIZE = 500;

class UpstreamError extends Error {
  constructor(message, { category = 'supabase_query', cause = null } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.category = category;
    this.cause = cause;
  }
}

function isUpstreamError(err) {
  return Boolean(err && (err.name === 'UpstreamError' || err instanceof UpstreamError));
}

function isProductionLike(env = process.env) {
  if (env.NODE_ENV === 'production') return true;
  const site = String(env.SITE_URL || '').toLowerCase();
  return site.includes('thefloridabuzz.com');
}

function allowSampleArticles(env = process.env) {
  if (env.ALLOW_SAMPLE_ARTICLES === 'true') return true;
  if (env.ALLOW_SAMPLE_ARTICLES === 'false') return false;
  if (isProductionLike(env)) return false;
  return true;
}

function isPlaceholderSlug(slug) {
  const s = String(slug || '').toLowerCase();
  return (
    s.startsWith('sample-') ||
    s === 'insufficient-source-material' ||
    s.startsWith('insufficient-source-material') ||
    s === 'insufficient-source-content' ||
    s.startsWith('insufficient-source-content')
  );
}

function isIndexableArticle(article) {
  if (!article || !article.slug) return false;
  if (isPlaceholderSlug(article.slug)) return false;
  if (isRedirectedArticleSlug(article.slug)) return false;
  const title = String(article.title || '').toLowerCase();
  if (title.includes('insufficient source material')) return false;
  if (title.includes('insufficient source content')) return false;
  return true;
}

function sampleArticles() {
  const now = new Date();
  const mk = (i, category, title, dek, source) => ({
    slug: `sample-${category}-${i}`,
    title,
    dek,
    body_html: `<p>This is placeholder content. Once the automation is connected to Supabase and the RSS sources, real articles will replace this sample.</p><p>${dek}</p>`,
    category,
    source_name: source,
    source_url: '#',
    image_url: null,
    featured: i === 0,
    published_at: new Date(now - i * 3600000).toISOString(),
  });

  return [
    mk(0, 'theme-parks', 'Disney Unveils New Holiday Parade for Magic Kingdom', 'A first look at the new floats, music, and characters coming this winter season.', 'Disney Parks Blog'),
    mk(1, 'space', 'SpaceX Targets Tonight for Falcon 9 Launch from the Cape', 'Here is the best viewing spot if you want to catch tonight\'s liftoff from the Space Coast.', 'NASA'),
    mk(2, 'beaches', 'Five Quiet Florida Beaches Locals Don\'t Want You to Know About', 'Skip the crowds at these lesser-known stretches of sand from the Panhandle to the Keys.', 'Visit Florida'),
    mk(3, 'wildlife', 'Rare Manatee Gathering Spotted Near Crystal River', 'Wildlife officials confirm an unusually large pod has moved into the springs this week.', 'Florida Fish & Wildlife'),
    mk(4, 'theme-parks', 'Universal Epic Universe Adds New Seasonal Event', 'Universal Orlando has announced details for its next limited-time experience.', 'Universal Orlando Blog'),
    mk(5, 'florida-living', 'Cold Front to Bring Rare Chill to Central Florida This Week', 'Temperatures could dip into the 40s overnight across several counties.', 'National Weather Service'),
    mk(6, 'cruises', 'New Cruise Itinerary Launches from Port Canaveral', 'A major cruise line just added a new four-night Bahamas sailing.', 'Cruise Line News'),
    mk(7, 'events', 'Fourth of July Fireworks Guide: Best Shows Across Florida', 'Our roundup of the top fireworks displays from Pensacola to Miami.', 'Visit Florida'),
  ];
}

function filterSample(sample, { category, city, evergreenOnly, excludeEvergreen, slug, author, limit } = {}) {
  let rows = sample.slice();
  if (category) rows = rows.filter((a) => a.category === category);
  if (city) rows = rows.filter((a) => a.city === city);
  if (evergreenOnly) rows = rows.filter((a) => a.is_evergreen);
  if (excludeEvergreen) rows = rows.filter((a) => !a.is_evergreen);
  if (slug) rows = rows.filter((a) => a.slug === slug);
  if (author) rows = rows.filter((a) => a.source_name === author);
  if (!slug) rows = filterRedirectedArticles(rows);
  return limit ? rows.slice(0, limit) : rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createArticlesQuery({
  client = null,
  env = process.env,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  sleepFn = sleep,
  sampleFn = sampleArticles,
} = {}) {
  async function executeWithRetry(runQuery) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const { data, error, count } = await runQuery();
      if (!error) {
        return { data: data || [], count: typeof count === 'number' ? count : null };
      }
      lastError = error;
      if (attempt < maxRetries) {
        console.error(
          JSON.stringify({
            type: 'upstream_retry',
            category: 'supabase_query',
            attempt: attempt + 1,
            message: String(error.message || error).slice(0, 300),
          })
        );
        await sleepFn(retryDelayMs);
      }
    }
    throw new UpstreamError(
      `Supabase query failed after ${maxRetries + 1} attempt(s): ${lastError?.message || lastError}`,
      { category: 'supabase_query', cause: lastError }
    );
  }

  async function hasAnyRealArticles() {
    if (!client) {
      return { ok: true, count: 0, hasArticles: false, source: 'no_client' };
    }
    try {
      const { count } = await executeWithRetry(async () =>
        client.from('articles').select('*', { count: 'exact', head: true })
      );
      const n = Number(count) || 0;
      return { ok: true, count: n, hasArticles: n > 0, source: 'database' };
    } catch (err) {
      if (!isUpstreamError(err)) {
        return {
          ok: false,
          error: new UpstreamError(err.message || String(err), { category: 'supabase_query', cause: err }),
        };
      }
      return { ok: false, error: err };
    }
  }

  async function queryArticles({
    category,
    city,
    limit,
    evergreenOnly,
    excludeEvergreen,
    slug,
    author,
    offset,
  } = {}) {
    if (!client) {
      if (allowSampleArticles(env)) {
        return {
          ok: true,
          articles: filterSample(sampleFn(), {
            category,
            city,
            evergreenOnly,
            excludeEvergreen,
            slug,
            author,
            limit,
          }),
          source: 'sample',
        };
      }
      throw new UpstreamError('Supabase client is not configured', { category: 'supabase_unavailable' });
    }

    const applyFilters = (query) => {
      let q = query;
      if (category) q = q.eq('category', category);
      if (city) q = q.eq('city', city);
      if (evergreenOnly) q = q.eq('is_evergreen', true);
      if (excludeEvergreen) q = q.eq('is_evergreen', false);
      if (slug) q = q.eq('slug', slug);
      if (author) q = q.eq('source_name', author);
      return q;
    };

    // Exact slug lookups stay single-shot. Bounded lists over-fetch slightly so
    // non-public records can be filtered without shrinking the page. Unbounded
    // archive lists paginate until exhausted (Supabase caps a single response).
    if (!slug && !limit && typeof offset !== 'number') {
      const all = [];
      let from = 0;
      for (;;) {
        const to = from + PAGE_BATCH_SIZE - 1;
        const { data } = await executeWithRetry(async () =>
          applyFilters(
            client.from('articles').select('*')
              .order('published_at', { ascending: false })
              .order('slug', { ascending: true })
          ).range(from, to)
        );
        if (!data.length) break;
        all.push(...data);
        if (data.length < PAGE_BATCH_SIZE) break;
        from += PAGE_BATCH_SIZE;
      }
      return { ok: true, articles: all.filter(isIndexableArticle), source: 'database' };
    }

    const fetchLimit = !slug && limit ? Math.min(Number(limit) + 8, 1000) : limit;
    const { data } = await executeWithRetry(async () => {
      let query = applyFilters(
        client.from('articles').select('*').order('published_at', { ascending: false })
      );
      if (typeof offset === 'number' && offset > 0) {
        query = query.range(offset, offset + (fetchLimit || PAGE_BATCH_SIZE) - 1);
      } else if (fetchLimit) {
        query = query.limit(fetchLimit);
      }
      return query;
    });

    const rows = slug ? data : data.filter(isIndexableArticle);
    const articles = limit && !slug ? rows.slice(0, limit) : rows;
    return { ok: true, articles, source: 'database' };
  }

  /**
   * Deterministic paginated fetch until exhausted. Never returns [] on error —
   * throws UpstreamError after retries.
   */
  async function fetchAllIndexableArticles({ batchSize = PAGE_BATCH_SIZE } = {}) {
    if (!client) {
      throw new UpstreamError('Supabase client is not configured', { category: 'supabase_unavailable' });
    }
    const all = [];
    let from = 0;
    for (;;) {
      const to = from + batchSize - 1;
      const { data } = await executeWithRetry(async () =>
        client
          .from('articles')
          .select('slug,title,dek,category,published_at,created_at,content_updated_at,is_evergreen,source_name,city')
          .order('published_at', { ascending: false })
          .order('slug', { ascending: true })
          .range(from, to)
      );
      if (!data.length) break;
      for (const row of data) {
        if (isIndexableArticle(row)) all.push(row);
      }
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return all;
  }

  return {
    queryArticles,
    hasAnyRealArticles,
    fetchAllIndexableArticles,
    allowSampleArticles: () => allowSampleArticles(env),
  };
}

module.exports = {
  UpstreamError,
  isUpstreamError,
  isProductionLike,
  allowSampleArticles,
  isPlaceholderSlug,
  isIndexableArticle,
  sampleArticles,
  createArticlesQuery,
  PAGE_BATCH_SIZE,
};
