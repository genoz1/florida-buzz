const MAX_GENERATION_ATTEMPTS = Number(process.env.IMAGE_REPAIR_MAX_GENERATIONS || 4);
const MAX_PROVIDER_FAILURES = Number(process.env.IMAGE_REPAIR_MAX_PROVIDER_FAILURES || 8);
const MAX_REVIEW_ATTEMPTS = Number(process.env.IMAGE_REPAIR_MAX_REVIEWS || 6);
const MAX_BACKOFF_HOURS = 24;

function safeText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nextAttempt(attempt, now = new Date()) {
  const hours = Math.min(MAX_BACKOFF_HOURS, Math.max(1, 2 ** Math.min(Number(attempt) || 0, 5)));
  return new Date(now.getTime() + (hours * 60 * 60 * 1000)).toISOString();
}

function imageContext(article = {}, extra = {}) {
  return {
    title: safeText(article.title, 250),
    category: safeText(article.category, 40),
    dek: safeText(article.dek, 500),
    bodyHtml: String(article.body_html || article.bodyHtml || '').slice(0, 12000),
    location: safeText(extra.location || article.image_location || article.location || article.city, 120),
    imageSubject: safeText(extra.imageSubject || article.image_subject || article.title, 180),
    imageEntities: Array.isArray(extra.imageEntities || article.image_entities)
      ? [...new Set((extra.imageEntities || article.image_entities).map((value) => safeText(value, 80)).filter(Boolean))].slice(0, 12)
      : [],
  };
}

function createImageRepairQueue(client, { logger = console, now = () => new Date() } = {}) {
  async function get(articleId) {
    if (!client) return null;
    const { data, error } = await client.from('article_image_repairs')
      .select('*').eq('article_id', articleId).maybeSingle();
    if (error) throw new Error(`Could not load image repair state: ${error.message}`);
    return data || null;
  }

  async function enqueue(article, {
    reason = 'missing_image',
    context = {},
    result = null,
    immediate = true,
  } = {}) {
    if (!client || !article?.id || !article?.slug) return false;
    const existing = await get(article.id);
    const candidateUrl = result?.candidateUrl
      || (['review_pending', 'needs_manual'].includes(existing?.status) ? existing.candidate_image_url : null);
    const preserveReviewPending = !result && existing?.status === 'review_pending' && Boolean(candidateUrl);
    const preserveRetry = !result && (preserveReviewPending || existing?.status === 'needs_manual');
    const status = preserveRetry ? existing.status
      : candidateUrl && result?.status === 'review_failed' ? 'review_pending' : 'pending';
    const generationAttempts = Math.max(existing?.generation_attempts || 0, result?.generationAttempts || 0);
    const reviewAttempts = Math.max(existing?.review_attempts || 0, result?.reviewAttempts || 0);
    const row = {
      article_id: article.id,
      article_slug: article.slug,
      status,
      reason: safeText(reason, 120) || 'missing_image',
      image_context: imageContext(article, context),
      original_image_url: existing?.original_image_url || article.image_url || null,
      candidate_image_url: candidateUrl,
      generation_attempts: generationAttempts,
      provider_failures: existing?.provider_failures || 0,
      review_attempts: reviewAttempts,
      last_error: safeText(result?.error || existing?.last_error),
      correction: safeText(result?.correction || existing?.correction),
      next_attempt_at: preserveRetry && existing?.next_attempt_at
        ? existing.next_attempt_at
        : immediate ? now().toISOString() : nextAttempt(reviewAttempts, now()),
      updated_at: now().toISOString(),
    };
    const { error } = await client.from('article_image_repairs').upsert(row, { onConflict: 'article_id' });
    if (error) {
      logger.error(`  [warning] Could not queue image repair for ${article.slug}: ${error.message}`);
      return false;
    }
    return true;
  }

  async function loadDue(limit = 3) {
    if (!client) return [];
    const { data, error } = await client.from('article_image_repairs')
      .select('*')
      .in('status', ['pending', 'review_pending'])
      .lte('next_attempt_at', now().toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(Math.max(1, Math.min(Number(limit) || 3, 20)));
    if (error) throw new Error(`Could not load due image repairs: ${error.message}`);
    return data || [];
  }

  async function update(articleId, patch) {
    const { error } = await client.from('article_image_repairs').update({
      ...patch,
      updated_at: now().toISOString(),
    }).eq('article_id', articleId);
    if (error) throw new Error(`Could not update image repair state: ${error.message}`);
  }

  async function markProviderFailure(job, error) {
    const failures = (job.provider_failures || 0) + 1;
    const exhausted = failures >= MAX_PROVIDER_FAILURES;
    await update(job.article_id, {
      status: exhausted ? 'needs_manual' : 'pending',
      generation_attempts: job.generation_attempts || 0,
      provider_failures: failures,
      last_error: exhausted
        ? `Maximum automatic provider retries reached: ${safeText(error?.message || error, 430)}`
        : safeText(error?.message || error),
      next_attempt_at: nextAttempt(failures, now()),
    });
  }

  async function markReviewFailure(job, error) {
    const attempts = (job.review_attempts || 0) + 1;
    const exhausted = attempts >= MAX_REVIEW_ATTEMPTS;
    await update(job.article_id, {
      status: exhausted ? 'needs_manual' : 'review_pending',
      review_attempts: attempts,
      last_error: exhausted
        ? `Maximum automatic review retries reached: ${safeText(error?.message || error, 430)}`
        : safeText(error?.message || error),
      next_attempt_at: nextAttempt(attempts, now()),
    });
  }

  async function markCandidate(job, candidateUrl, generationAttempts = 1) {
    await update(job.article_id, {
      status: 'review_pending',
      candidate_image_url: candidateUrl,
      generation_attempts: (job.generation_attempts || 0) + generationAttempts,
      review_attempts: 0,
      last_error: null,
      next_attempt_at: now().toISOString(),
    });
  }

  async function markRejected(job, correction) {
    const attempts = job.generation_attempts || 0;
    const exhausted = attempts >= MAX_GENERATION_ATTEMPTS;
    await update(job.article_id, {
      status: exhausted ? 'needs_manual' : 'pending',
      candidate_image_url: null,
      review_attempts: job.review_attempts || 0,
      correction: safeText(correction),
      last_error: exhausted ? 'Maximum automatic generation attempts reached.' : 'Generated image rejected by quality review.',
      next_attempt_at: exhausted ? nextAttempt(24, now()) : nextAttempt(attempts, now()),
    });
  }

  async function markAccepted(job, imageUrl) {
    await update(job.article_id, {
      status: 'accepted',
      candidate_image_url: imageUrl,
      generation_attempts: job.generation_attempts || 0,
      review_attempts: job.review_attempts || 0,
      last_error: null,
      correction: null,
      accepted_at: now().toISOString(),
      next_attempt_at: now().toISOString(),
    });
  }

  return {
    enqueue,
    get,
    loadDue,
    markAccepted,
    markCandidate,
    markProviderFailure,
    markRejected,
    markReviewFailure,
    update,
  };
}

module.exports = {
  MAX_GENERATION_ATTEMPTS,
  MAX_PROVIDER_FAILURES,
  MAX_REVIEW_ATTEMPTS,
  createImageRepairQueue,
  imageContext,
  nextAttempt,
  safeText,
};
