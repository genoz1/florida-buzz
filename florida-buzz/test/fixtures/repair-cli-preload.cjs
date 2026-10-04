// Isolated CLI integration fixture: no network, image API, or production writes.
const Module = require('node:module');
const originalLoad = Module._load;
const target = 'disney-world-hispanic-heritage-month-2026';
const other = 'miami-events-and-things-to-do-this-weekend-october-2-4';
const articles = [target, other].map((slug, index) => ({
  id: `id-${index}`, slug, title: slug, category: 'theme-parks', image_url: null,
  published_at: new Date().toISOString(),
}));
const repairs = articles.map((article) => ({
  article_id: article.id, article_slug: article.slug, status: article.slug === target ? 'needs_manual' : 'pending',
  generation_attempts: article.slug === target ? 4 : 0, review_attempts: 0, provider_failures: 0,
  image_context: {}, candidate_image_url: null, next_attempt_at: '2026-01-01T00:00:00Z',
  last_error: article.slug === target ? 'Maximum automatic generation attempts reached.' : 'missing_image',
}));
const generated = [], seeded = [];
const client = { from(table) {
  let rows = table === 'articles' ? articles : repairs;
  const filters = []; let patch;
  const selected = () => rows.filter((row) => filters.every((f) => f(row)));
  const chain = {
    select() { return chain; },
    eq(field, value) { filters.push((r) => r[field] === value); return chain; },
    neq(field, value) { filters.push((r) => r[field] !== value); return chain; },
    in(field, values) { filters.push((r) => values.includes(r[field])); return chain; },
    gte() { return chain; }, lte() { return chain; }, order() { return chain; }, limit() { return chain; },
    update(values) { patch = values; return chain; },
    async upsert(values) { seeded.push(values.article_slug); Object.assign(repairs.find((r) => r.article_id === values.article_id), values); return {}; },
    async maybeSingle() { return { data: selected()[0] || null }; },
    then(resolve, reject) { if (patch) selected().forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: selected() }).then(resolve, reject); },
  };
  return chain;
} };
Module._load = function(request, parent, isMain) {
  const filename = Module._resolveFilename(request, parent, isMain);
  if (filename.endsWith('/lib/supabase.js')) return { supabase: client, thumbUrl: (url) => url };
  if (filename.endsWith('/lib/imageGen.js')) return {
    generateArticleImageResult: async (article, options) => {
      generated.push({ slug: article.slug, maxAttempts: options.maxAttempts });
      return { status: 'generation_failed', error: 'fixture stop; no API called', generationAttempts: 0 };
    },
  };
  return originalLoad.apply(this, arguments);
};
process.on('exit', () => console.log('CLI_PROOF=' + JSON.stringify({ generated, seeded, repairs })));
