const { normalizePlainText, validateStarter } = require('./community/validation');

const MIN_CONFIDENCE = 0.78;
const REUSE_THRESHOLD = 0.56;
const UNCERTAIN_THRESHOLD = 0.36;
const MAX_EXISTING_CANDIDATES = 100;

const STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'but', 'by',
  'can', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'if', 'in',
  'is', 'it', 'its', 'more', 'of', 'on', 'or', 'should', 'still', 'than', 'that',
  'the', 'their', 'this', 'to', 'too', 'what', 'when', 'where', 'which', 'who',
  'why', 'will', 'with', 'would', 'you', 'your',
]);

const SYNONYMS = new Map([
  ['cost', 'price'], ['costs', 'price'], ['expensive', 'price'], ['pricing', 'price'],
  ['trip', 'vacation'], ['trips', 'vacation'], ['vacations', 'vacation'],
  ['hotel', 'resort'], ['hotels', 'resort'], ['resorts', 'resort'],
  ['ride', 'attraction'], ['rides', 'attraction'], ['attractions', 'attraction'],
  ['worth', 'value'], ['valuable', 'value'], ['justify', 'value'], ['justified', 'value'],
]);

function slugify(value) {
  return normalizePlainText(value).toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 90)
    .replace(/-+$/g, '');
}

function tokenSet(value) {
  const tokens = normalizePlainText(value).toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SYNONYMS.get(token) || token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function discussionSimilarity(candidate, existing) {
  const questionScore = jaccard(tokenSet(candidate.question), tokenSet(existing.question));
  const topicScore = jaccard(tokenSet(candidate.topic), tokenSet(existing.topic));
  const entityScore = jaccard(
    tokenSet((candidate.entities || []).join(' ')),
    tokenSet(`${existing.question || ''} ${existing.topic || ''}`)
  );
  return Math.max(questionScore, (questionScore * 0.72) + (topicScore * 0.18) + (entityScore * 0.1));
}

function findDiscussionMatch(candidate, existingDiscussions) {
  const ranked = (existingDiscussions || [])
    .filter((discussion) => discussion.category === candidate.category)
    .map((discussion) => ({ discussion, score: discussionSimilarity(candidate, discussion) }))
    .sort((left, right) => right.score - left.score);
  const closest = ranked[0] || null;
  if (!closest) return { action: 'create', score: 0, discussion: null };
  if (closest.score >= REUSE_THRESHOLD) return { action: 'reuse', ...closest };
  if (closest.score >= UNCERTAIN_THRESHOLD) return { action: 'skip', reason: 'duplicate_uncertain', ...closest };
  return { action: 'create', ...closest };
}

function parseDiscussionMetadata(article) {
  if (article?.discussion_worthy !== true) return { eligible: false, reason: 'not_discussion_worthy' };
  const confidence = Number(article.discussion_confidence);
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE || confidence > 1) {
    return { eligible: false, reason: 'low_or_invalid_confidence' };
  }

  const question = normalizePlainText(article.discussion_question);
  if (!question.endsWith('?') || /^are you excited\b/i.test(question) || /^what do you think\b/i.test(question)) {
    return { eligible: false, reason: 'weak_question' };
  }
  const entities = Array.isArray(article.discussion_entities)
    ? [...new Set(article.discussion_entities.map(normalizePlainText).filter((value) => value && value.length <= 60))].slice(0, 10)
    : [];
  try {
    const starter = validateStarter({
      slug: slugify(question),
      question,
      context: article.discussion_context,
      category: article.discussion_category,
      topic: article.discussion_topic,
    });
    return {
      eligible: true,
      confidence,
      reason: normalizePlainText(article.discussion_reason).slice(0, 300) || null,
      structure: normalizePlainText(article.discussion_structure).slice(0, 80) || null,
      entities,
      ...starter,
    };
  } catch {
    return { eligible: false, reason: 'invalid_discussion_metadata' };
  }
}

async function linkArticle(client, articleId, discussionId) {
  const { data, error } = await client.from('articles')
    .update({ buzz_discussion_id: discussionId })
    .eq('id', articleId)
    .select('id, buzz_discussion_id')
    .single();
  if (error) throw new Error(`Could not associate article and discussion: ${error.message}`);
  return data;
}

async function uniqueDiscussionSlug(client, baseSlug, articleSlug) {
  const { data, error } = await client.from('discussions').select('id').eq('slug', baseSlug).maybeSingle();
  if (error) throw new Error(`Could not check discussion slug: ${error.message}`);
  if (!data) return baseSlug;
  const suffix = slugify(articleSlug).slice(-18) || 'article';
  return `${baseSlug.slice(0, 100 - suffix.length - 1).replace(/-+$/g, '')}-${suffix}`;
}

async function integrateArticleDiscussion({ client, article, metadata }) {
  if (!client || !article?.id) throw new Error('Article discussion integration requires a saved article.');
  const candidate = parseDiscussionMetadata(metadata);
  if (!candidate.eligible) return { action: 'skipped', reason: candidate.reason };

  const { data: existing, error: existingError } = await client.from('discussions')
    .select('id, slug, question, topic, category')
    .eq('category', candidate.category)
    .in('status', ['published', 'locked'])
    .eq('moderation_status', 'published')
    .limit(MAX_EXISTING_CANDIDATES);
  if (existingError) throw new Error(`Could not check existing discussions: ${existingError.message}`);

  const match = findDiscussionMatch(candidate, existing || []);
  if (match.action === 'skip') {
    return { action: 'skipped', reason: match.reason, similarity: match.score };
  }
  if (match.action === 'reuse') {
    await linkArticle(client, article.id, match.discussion.id);
    return { action: 'reused', discussion: match.discussion, similarity: match.score };
  }

  const { data: admin, error: adminError } = await client.from('profiles')
    .select('user_id')
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (adminError || !admin) throw new Error(`Could not resolve an active Buzz Board admin: ${adminError?.message || 'none exists'}`);

  const slug = await uniqueDiscussionSlug(client, candidate.slug, article.slug);
  const { data: created, error: createError } = await client.from('discussions').insert({
    slug,
    question: candidate.question,
    context: candidate.context,
    category: candidate.category,
    topic: candidate.topic,
    source_type: 'article',
    status: 'published',
    moderation_status: 'published',
    related_article_id: article.id,
    created_by: admin.user_id,
    starter_label: 'Florida Buzz',
  }).select('id, slug, question, topic, category').single();
  if (createError) throw new Error(`Could not create article discussion: ${createError.message}`);

  try {
    await linkArticle(client, article.id, created.id);
  } catch (error) {
    await client.from('discussions').delete().eq('id', created.id);
    throw error;
  }
  return { action: 'created', discussion: created, similarity: match.score || 0 };
}

async function publishArticleWithOptionalDiscussion({
  articleRow,
  discussionMetadata,
  enabled,
  insertArticle,
  integrateDiscussion,
  logger = console,
}) {
  const article = await insertArticle(articleRow);
  if (!enabled) return { article, discussion: { action: 'skipped', reason: 'integration_disabled' } };
  try {
    const discussion = await integrateDiscussion(article, discussionMetadata);
    return { article, discussion };
  } catch (error) {
    logger.warn?.(`  [warning] Article published, but Buzz Board integration was skipped: ${error.message}`);
    return { article, discussion: { action: 'failed', reason: 'integration_error' }, discussionError: error };
  }
}

async function loadArticleDiscussion(client, article, enabled) {
  if (!enabled || !client || !article?.buzz_discussion_id) return null;
  const { data, error } = await client.from('discussions')
    .select('id, slug, question, category, response_count')
    .eq('id', article.buzz_discussion_id)
    .in('status', ['published', 'locked'])
    .eq('moderation_status', 'published')
    .maybeSingle();
  if (error) return null;
  return data || null;
}

module.exports = {
  MIN_CONFIDENCE,
  REUSE_THRESHOLD,
  UNCERTAIN_THRESHOLD,
  discussionSimilarity,
  findDiscussionMatch,
  integrateArticleDiscussion,
  loadArticleDiscussion,
  parseDiscussionMetadata,
  publishArticleWithOptionalDiscussion,
};
