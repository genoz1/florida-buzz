const { imageSize } = require('image-size');
const { findDuplicateImage } = require('./articleImages');
const { generateArticleImageResult } = require('./imageGen');
const { validateGeneratedImage, assertCompletedReview } = require('./imageValidation');
const { createImageRepairQueue, generationLimit } = require('./imageRepairQueue');
const { storeGeneratedImage } = require('./supabase');

async function fetchCandidate(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    const error = new Error(`Stored candidate fetch returned HTTP ${response.status}.`);
    error.candidateInvalid = response.status === 404 || response.status === 410;
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  try {
    const dimensions = imageSize(buffer);
    if (!dimensions.width || !dimensions.height) throw new Error('Missing dimensions');
  } catch {
    const error = new Error('Stored candidate is corrupt or not an image.');
    error.candidateInvalid = true;
    throw error;
  }
  return buffer;
}

function validationContext(job) {
  const context = job.image_context || {};
  return {
    title: context.title || job.article_slug,
    subject: context.imageSubject || context.title || job.article_slug,
    location: context.location || '',
    entities: context.imageEntities || [],
    category: context.category || '',
    imagePrompt: context.imagePrompt || `Photorealistic editorial image for ${context.title || job.article_slug}`,
  };
}

async function duplicateFor(client, imageUrl, currentSlug) {
  const { data, error } = await client.from('articles')
    .select('slug, title, image_url')
    .eq('image_url', imageUrl)
    .limit(25);
  if (error) throw new Error(`Could not verify image uniqueness: ${error.message}`);
  return findDuplicateImage(imageUrl, data || [], currentSlug);
}

async function attachCandidate(client, queue, job, imageUrl) {
  const duplicate = await duplicateFor(client, imageUrl, job.article_slug);
  if (duplicate) {
    await queue.markRejected(job, `Exact image already belongs to ${duplicate.title}.`);
    return { status: 'rejected_duplicate', slug: job.article_slug };
  }

  let query = client.from('articles').update({ image_url: imageUrl }).eq('id', job.article_id);
  query = job.original_image_url
    ? query.eq('image_url', job.original_image_url)
    : query.is('image_url', null);
  const { data, error } = await query.select('id, slug, image_url').maybeSingle();
  if (error) throw new Error(`Could not attach accepted image: ${error.message}`);
  if (!data) {
    const { data: current } = await client.from('articles')
      .select('id, slug, image_url').eq('id', job.article_id).maybeSingle();
    if (current?.image_url) {
      await queue.markAccepted(job, current.image_url);
      return { status: 'already_repaired', slug: job.article_slug, imageUrl: current.image_url };
    }
    throw new Error('Article changed before the accepted image could be attached.');
  }
  await queue.markAccepted(job, imageUrl);
  return { status: 'accepted', slug: job.article_slug, imageUrl };
}

async function reviewStoredCandidate(client, queue, job, {
  validate = validateGeneratedImage,
  fetchImpl = fetch,
} = {}) {
  let buffer;
  try {
    buffer = await fetchCandidate(job.candidate_image_url, fetchImpl);
  } catch (error) {
    if (error.candidateInvalid) await queue.markRejected(job, error.message);
    else await queue.markReviewFailure(job, error);
    return { status: 'candidate_fetch_failed', slug: job.article_slug, error: error.message };
  }

  let review;
  try {
    review = assertCompletedReview(await validate(buffer, validationContext(job)));
  } catch (error) {
    await queue.markReviewFailure(job, error);
    return { status: 'review_failed', slug: job.article_slug, reusedCandidate: true, error: error.message };
  }
  if (!review?.acceptable) {
    await queue.markRejected(job, review?.correction || review?.issues?.join('; ') || 'Image did not pass review.');
    return { status: 'rejected', slug: job.article_slug };
  }
  return attachCandidate(client, queue, job, job.candidate_image_url);
}

async function processImageRepairJob(client, queue, job, {
  maxGenerations = 2,
  generate = generateArticleImageResult,
  validate = validateGeneratedImage,
  fetchImpl = fetch,
  store = (buffer, filename) => storeGeneratedImage(buffer, filename, 'image/png', { contentAddressed: true }),
} = {}) {
  if (job.status === 'review_pending' && job.candidate_image_url) {
    return reviewStoredCandidate(client, queue, job, { validate, fetchImpl });
  }
  if ((job.generation_attempts || 0) >= generationLimit(job)) {
    await queue.update(job.article_id, {
      status: 'needs_manual',
      last_error: 'Maximum automatic generation attempts reached.',
    });
    return { status: 'needs_manual', slug: job.article_slug };
  }

  const context = job.image_context || {};
  let result;
  try {
    result = await generate({
      title: context.title || job.article_slug,
      category: context.category || '',
      slug: job.article_slug,
      dek: context.dek || '',
      bodyHtml: context.bodyHtml || '',
      location: context.location || '',
      imageSubject: context.imageSubject || context.title || job.article_slug,
      imageEntities: context.imageEntities || [],
    }, {
      maxAttempts: Math.min(2, maxGenerations, generationLimit(job) - (job.generation_attempts || 0)),
      // A persisted correction may have been written by an older reviewer contract and can
      // reintroduce obsolete, over-prescriptive composition demands. Corrections produced by
      // the current reviewer still guide the immediate second attempt inside imageGen.
      priorCorrection: '',
      store,
      validate,
    });
  } catch (error) {
    await queue.markProviderFailure(job, error);
    return { status: 'generation_failed', slug: job.article_slug, error: error.message };
  }

  if (result?.status === 'accepted' && result.url) {
    const current = {
      ...job,
      generation_attempts: (job.generation_attempts || 0) + (result.generationAttempts || 1),
      review_attempts: (job.review_attempts || 0) + (result.reviewAttempts || 1),
    };
    return attachCandidate(client, queue, current, result.url);
  }
  if (result?.candidateUrl) {
    const generationAttempts = result.generationAttempts || 1;
    const reviewAttempts = result.reviewAttempts || 1;
    await queue.markCandidate(job, result.candidateUrl, generationAttempts);
    const current = {
      ...job,
      candidate_image_url: result.candidateUrl,
      generation_attempts: (job.generation_attempts || 0) + generationAttempts,
      review_attempts: (job.review_attempts || 0) + reviewAttempts,
    };
    if (result.status === 'review_failed') {
      await queue.markReviewFailure({ ...current, review_attempts: current.review_attempts - 1 }, new Error(result.error || 'Image review failed technically.'));
      return { status: 'review_failed', slug: job.article_slug, reusedCandidate: true };
    }
    await queue.markRejected(current, result.correction || 'Image did not pass review.');
    return { status: 'rejected', slug: job.article_slug };
  }
  const attemptedJob = {
    ...job,
    generation_attempts: (job.generation_attempts || 0) + (result?.generationAttempts || 0),
  };
  if (attemptedJob.generation_attempts >= generationLimit(job)) {
    await queue.update(job.article_id, {
      status: 'needs_manual',
      generation_attempts: attemptedJob.generation_attempts,
      last_error: result?.error || 'Maximum automatic generation attempts reached.',
    });
    return { status: 'needs_manual', slug: job.article_slug };
  }
  await queue.markProviderFailure(attemptedJob, new Error(result?.error || `Image attempt ended with ${result?.status || 'an unknown failure'}.`));
  return { status: result?.status || 'generation_failed', slug: job.article_slug };
}

async function runImageRepairBatch(client, {
  limit = Number(process.env.IMAGE_REPAIR_GENERATION_LIMIT || 3),
  logger = console,
  slugs = [],
  recoverLegacy = false,
  ...dependencies
} = {}) {
  if (!client) throw new Error('Supabase is required for article image repair.');
  const queue = createImageRepairQueue(client, { logger });
  let jobs;
  if (slugs.length) {
    const { data, error } = await client.from('article_image_repairs').select('*').in('article_slug', slugs);
    if (error) throw error;
    jobs = [];
    for (let job of data || []) {
      if (recoverLegacy) job = await queue.recoverLegacy(job);
      if (['pending', 'review_pending'].includes(job.status) && job.next_attempt_at <= new Date().toISOString()) jobs.push(job);
    }
  } else jobs = await queue.loadDue(limit);
  let remainingGenerations = Math.max(0, Math.floor(Number(limit) || 0));
  const results = [];
  for (const job of jobs) {
    if (remainingGenerations <= 0 && !(job.status === 'review_pending' && job.candidate_image_url)) continue;
    const allowance = job.status === 'review_pending' && job.candidate_image_url ? 0 : Math.min(2, remainingGenerations, generationLimit(job) - (job.generation_attempts || 0));
    remainingGenerations -= Math.max(0, allowance); // Reserve API calls, including blocked/failed requests.
    try {
      const result = await processImageRepairJob(client, queue, job, { ...dependencies, maxGenerations: allowance });
      
      results.push(result);
      logger.log(`[image-repair] ${job.article_slug}: ${result.status}`);
    } catch (error) {
      await queue.markProviderFailure(job, error).catch(() => {});
      results.push({ status: 'failed', slug: job.article_slug, error: error.message });
      logger.error(`[image-repair] ${job.article_slug}: ${error.message}`);
    }
  }
  return results;
}

module.exports = {
  attachCandidate,
  fetchCandidate,
  processImageRepairJob,
  reviewStoredCandidate,
  runImageRepairBatch,
  validationContext,
};
