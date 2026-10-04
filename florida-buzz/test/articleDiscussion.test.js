const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ejs = require('ejs');

const {
  findDiscussionMatch,
  integrateArticleDiscussion,
  parseDiscussionMetadata,
  publishArticleWithOptionalDiscussion,
} = require('../lib/articleDiscussion');

const root = path.join(__dirname, '..');
const ARTICLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DISCUSSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function worthy(overrides = {}) {
  return {
    discussion_worthy: true,
    discussion_reason: 'The change creates a meaningful planning tradeoff.',
    discussion_question: 'What would this attraction need to deliver for you to change an existing Disney trip around it?',
    discussion_context: 'Consider the attraction itself, the time required, and what you would give up elsewhere in the trip.',
    discussion_category: 'disney',
    discussion_topic: 'Trip-changing attractions',
    discussion_structure: 'threshold tradeoff',
    discussion_entities: ['Walt Disney World', 'new attraction'],
    discussion_confidence: 0.91,
    ...overrides,
  };
}

function createMemoryClient(seed = {}) {
  const state = {
    articles: [...(seed.articles || [])],
    discussions: [...(seed.discussions || [])],
    profiles: [...(seed.profiles || [{ user_id: ADMIN_ID, role: 'admin', status: 'active', created_at: '2026-01-01' }])],
  };

  class Query {
    constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; }
    select() { return this; }
    insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
    update(payload) { this.operation = 'update'; this.payload = payload; return this; }
    delete() { this.operation = 'delete'; return this; }
    eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
    in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; }
    order() { return this; }
    limit(value) { this.limitValue = value; return this; }
    rows() { return this.filters.reduce((rows, filter) => rows.filter(filter), state[this.table] || []); }
    async maybeSingle() { return this.execute(true); }
    async single() { return this.execute(true); }
    then(resolve, reject) { return this.execute(false).then(resolve, reject); }
    async execute(single) {
      if (this.operation === 'insert') {
        const row = { id: DISCUSSION_ID, ...this.payload };
        state[this.table].push(row);
        return { data: single ? row : [row], error: null };
      }
      if (this.operation === 'update') {
        const rows = this.rows();
        rows.forEach((row) => Object.assign(row, this.payload));
        return { data: single ? (rows[0] || null) : rows, error: null };
      }
      if (this.operation === 'delete') {
        const matched = new Set(this.rows());
        state[this.table] = state[this.table].filter((row) => !matched.has(row));
        return { data: [], error: null };
      }
      const rows = this.rows().slice(0, this.limitValue || Infinity);
      return { data: single ? (rows[0] || null) : rows, error: null };
    }
  }

  return { state, from: (table) => new Query(table) };
}

test('discussion-worthiness parser accepts strong metadata and fails safely on weak or invalid output', () => {
  const parsed = parseDiscussionMetadata(worthy());
  assert.equal(parsed.eligible, true);
  assert.equal(parsed.category, 'disney');
  assert.equal(parsed.confidence, 0.91);
  assert.equal(parseDiscussionMetadata(worthy({ discussion_confidence: 0.4 })).reason, 'low_or_invalid_confidence');
  assert.equal(parseDiscussionMetadata(worthy({ discussion_question: 'Are you excited about this attraction?' })).reason, 'weak_question');
  assert.equal(parseDiscussionMetadata({ discussion_worthy: false }).reason, 'not_discussion_worthy');
});

test('duplicate review reuses a close match, holds uncertainty, and permits distinct questions', () => {
  const candidate = parseDiscussionMetadata(worthy());
  const exact = [{ id: DISCUSSION_ID, category: 'disney', topic: candidate.topic, question: candidate.question }];
  assert.equal(findDiscussionMatch(candidate, exact).action, 'reuse');

  const uncertain = [{
    id: DISCUSSION_ID, category: 'disney', topic: 'Trip planning',
    question: 'What would make you rebuild an existing Disney trip around one new attraction?',
  }];
  assert.equal(findDiscussionMatch(candidate, uncertain).action, 'skip');

  const distinct = [{
    id: DISCUSSION_ID, category: 'disney', topic: 'Dining planning',
    question: 'Has planning Disney dining become homework that gets in the way of vacation?',
  }];
  assert.equal(findDiscussionMatch(candidate, distinct).action, 'create');
});

test('article integration reuses an existing conversation without creating a duplicate', async () => {
  const metadata = worthy();
  const client = createMemoryClient({
    articles: [{ id: ARTICLE_ID, slug: 'article-one', buzz_discussion_id: null }],
    discussions: [{
      id: DISCUSSION_ID, slug: 'existing-question', category: 'disney', topic: metadata.discussion_topic,
      question: metadata.discussion_question, status: 'published', moderation_status: 'published',
    }],
  });
  const result = await integrateArticleDiscussion({ client, article: { id: ARTICLE_ID, slug: 'article-one' }, metadata });
  assert.equal(result.action, 'reused');
  assert.equal(client.state.discussions.length, 1);
  assert.equal(client.state.articles[0].buzz_discussion_id, DISCUSSION_ID);
});

test('a distinct high-confidence article creates an article-sourced discussion and association', async () => {
  const client = createMemoryClient({ articles: [{ id: ARTICLE_ID, slug: 'article-two', buzz_discussion_id: null }] });
  const result = await integrateArticleDiscussion({ client, article: { id: ARTICLE_ID, slug: 'article-two' }, metadata: worthy() });
  assert.equal(result.action, 'created');
  assert.equal(client.state.discussions.length, 1);
  assert.equal(client.state.discussions[0].source_type, 'article');
  assert.equal(client.state.discussions[0].related_article_id, ARTICLE_ID);
  assert.equal(client.state.discussions[0].created_by, ADMIN_ID);
  assert.equal(client.state.articles[0].buzz_discussion_id, DISCUSSION_ID);
});

test('discussion integration failure cannot fail the primary article publication', async () => {
  const warnings = [];
  const result = await publishArticleWithOptionalDiscussion({
    articleRow: { slug: 'published-anyway' },
    discussionMetadata: worthy(),
    enabled: true,
    insertArticle: async (row) => ({ id: ARTICLE_ID, ...row }),
    integrateDiscussion: async () => { throw new Error('staging discussion unavailable'); },
    logger: { warn: (message) => warnings.push(message) },
  });
  assert.equal(result.article.slug, 'published-anyway');
  assert.equal(result.discussion.action, 'failed');
  assert.equal(warnings.length, 1);
});

test('article template renders a polished module only when a discussion exists', async () => {
  const base = {
    article: {
      slug: 'sample-article', title: 'A Florida Park Update', meta_title: 'Florida Park Update',
      dek: 'A useful update.', body_html: '<p>Article body.</p>', category: 'theme-parks',
      source_name: 'Official source', source_url: 'https://example.com', image_url: null,
      published_at: '2026-10-03T12:00:00Z', is_evergreen: false, is_review: false,
    },
    related: [], ticker: [], categoryLabels: { 'theme-parks': 'Theme Parks' },
    placeholderImg: () => '/placeholder.jpg', thumbUrl: (value) => value,
    resizeImg: (value) => value, timeAgo: () => 'today',
  };
  const filename = path.join(root, 'views/article.ejs');
  const withDiscussion = await ejs.renderFile(filename, {
    ...base,
    buzzDiscussion: { slug: 'real-question', question: 'What tradeoff matters most for this change?', response_count: 0 },
  }, { filename });
  assert.match(withDiscussion, /data-article-buzz-module/);
  assert.match(withDiscussion, /Start the conversation—no responses yet/);
  assert.match(withDiscussion, /\/buzz\/real-question/);

  const withoutDiscussion = await ejs.renderFile(filename, { ...base, buzzDiscussion: null }, { filename });
  assert.doesNotMatch(withoutDiscussion, /data-article-buzz-module/);
  assert.doesNotMatch(withoutDiscussion, /article-buzz\.js/);
});

test('article analytics payloads contain only event name and surface', () => {
  const script = fs.readFileSync(path.join(root, 'public/js/article-buzz.js'), 'utf8');
  assert.match(script, /article_buzz_module_impression/);
  assert.match(script, /article_buzz_join_click/);
  assert.match(script, /dataLayer\.push\(\{ event, surface: 'article' \}\)/);
  assert.doesNotMatch(script, /email|userId|articleBody|discussionText|responseText/);
});

test('Phase 5 migration adds only the optional article association and index', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261004100000_article_buzz_board_integration.sql'), 'utf8');
  assert.match(sql, /add column if not exists buzz_discussion_id uuid/);
  assert.match(sql, /references public\.discussions\(id\) on delete set null/);
  assert.match(sql, /articles_buzz_discussion_idx/);
  assert.doesNotMatch(sql, /insert into|create policy|alter table public\.discussions/);
});
