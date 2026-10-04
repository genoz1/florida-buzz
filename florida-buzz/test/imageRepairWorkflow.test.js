const test = require('node:test');
const assert = require('node:assert/strict');

const { processImageRepairJob, reviewStoredCandidate } = require('../lib/imageRepairWorkflow');
const { generateValidatedImageResult } = require('../lib/imageGen');
const {
  MAX_GENERATION_ATTEMPTS,
  MAX_PROVIDER_FAILURES,
  MAX_REVIEW_ATTEMPTS,
  nextAttempt,
} = require('../lib/imageRepairQueue');

const baseJob = {
  article_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  article_slug: 'sample-article',
  status: 'pending',
  generation_attempts: 0,
  provider_failures: 0,
  review_attempts: 0,
  image_context: {
    title: 'Sample Florida Article',
    category: 'events',
    imageSubject: 'Specific Florida event',
    imageEntities: ['Florida'],
  },
};

function queueRecorder() {
  const calls = [];
  return {
    calls,
    markAccepted: async (...args) => calls.push(['accepted', ...args]),
    markCandidate: async (...args) => calls.push(['candidate', ...args]),
    markProviderFailure: async (...args) => calls.push(['provider', ...args]),
    markRejected: async (...args) => calls.push(['rejected', ...args]),
    markReviewFailure: async (...args) => calls.push(['review', ...args]),
    update: async (...args) => calls.push(['update', ...args]),
  };
}

function articleClient() {
  const article = { id: baseJob.article_id, slug: baseJob.article_slug, image_url: null };
  return {
    article,
    client: {
      from(table) {
        assert.equal(table, 'articles');
        return {
          select() {
            return {
              eq(field, value) {
                if (field === 'image_url') return { limit: async () => ({ data: [], error: null }) };
                assert.equal(value, baseJob.article_id);
                return { maybeSingle: async () => ({ data: article, error: null }) };
              },
            };
          },
          update(values) {
            const chain = {
              eq() { return chain; },
              is() { return chain; },
              select() { return chain; },
              async maybeSingle() { Object.assign(article, values); return { data: article, error: null }; },
            };
            return chain;
          },
        };
      },
    },
  };
}

test('repair cycle passes the first rejection correction to a second generation and accepts it', async () => {
  const queue = queueRecorder();
  const { article, client } = articleClient();
  const prompts = [];
  const verdicts = [
    { acceptable: false, issues: ['Wrong entrance'], correction: 'Show the real Florida entrance' },
    { acceptable: true, issues: [], correction: '' },
  ];
  let configuredAttempts;
  const result = await processImageRepairJob(client, queue, baseJob, {
    generate: async (_article, options) => {
      configuredAttempts = options.maxAttempts;
      return generateValidatedImageResult('Specific Florida event entrance', { slug: baseJob.article_slug }, {
        ...options,
        generate: async (prompt) => { prompts.push(prompt); return Buffer.from(`image-${prompts.length}`); },
        validate: async () => verdicts.shift(),
      });
    },
    store: async (_buffer, filename) => `https://storage.example/${prompts.length}-${filename}`,
  });

  assert.equal(configuredAttempts, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Show the real Florida entrance/);
  assert.equal(result.status, 'accepted');
  assert.equal(article.image_url, 'https://storage.example/2-sample-article.png');
  const accepted = queue.calls.find((call) => call[0] === 'accepted');
  assert.equal(accepted[1].generation_attempts, 2);
  assert.equal(accepted[1].review_attempts, 2);
});

test('a persisted correction from an older reviewer is not replayed into a new paid generation', async () => {
  const queue = queueRecorder();
  let priorCorrection;
  const job = {
    ...baseJob,
    correction: 'Require an exact hooked lip, horn proportions, branded habitat cues, and a particular viewpoint',
  };
  const result = await processImageRepairJob({}, queue, job, {
    generate: async (_article, options) => {
      priorCorrection = options.priorCorrection;
      return { status: 'generation_failed', error: 'controlled test stop', generationAttempts: 0 };
    },
  });

  assert.equal(priorCorrection, '');
  assert.equal(result.status, 'generation_failed');
  assert.equal(queue.calls[0][0], 'provider');
});

test('provider failure and timeout remain isolated repair states', async () => {
  for (const message of ['provider unavailable', 'generation timeout']) {
    const queue = queueRecorder();
    const result = await processImageRepairJob({}, queue, baseJob, {
      generate: async () => ({ status: 'generation_failed', error: message }),
    });
    assert.equal(result.status, 'generation_failed');
    assert.equal(queue.calls.length, 1);
    assert.equal(queue.calls[0][0], 'provider');
  }
});

test('quality rejection advances generation state but never marks the image accepted', async () => {
  const queue = queueRecorder();
  const result = await processImageRepairJob({}, queue, baseJob, {
    generate: async () => ({
      status: 'rejected',
      candidateUrl: 'https://storage.example/rejected.jpg',
      correction: 'Wrong location',
    }),
  });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(queue.calls.map((call) => call[0]), ['candidate', 'rejected']);
  assert.equal(queue.calls.some((call) => call[0] === 'accepted'), false);
});

test('two genuine quality failures use exactly two generations and attach no image', async () => {
  const queue = queueRecorder();
  let generations = 0;
  const result = await processImageRepairJob({ from: () => { throw new Error('must not attach'); } }, queue, baseJob, {
    generate: async (_article, options) => generateValidatedImageResult('Specific Florida event', { slug: baseJob.article_slug }, {
      ...options,
      generate: async () => { generations += 1; return Buffer.from(`bad-image-${generations}`); },
      validate: async () => ({
        acceptable: false,
        issues: ['Wrong location'],
        correction: 'Use the named Florida location rather than generic scenery',
      }),
    }),
    store: async (_buffer, filename) => `https://storage.example/${generations}-${filename}`,
  });

  assert.equal(result.status, 'rejected');
  assert.equal(generations, 2);
  assert.equal(queue.calls.some((call) => call[0] === 'accepted'), false);
  assert.equal(queue.calls.find((call) => call[0] === 'candidate')[3], 2);
  const rejected = queue.calls.find((call) => call[0] === 'rejected');
  assert.equal(rejected[1].generation_attempts, 2);
  assert.equal(rejected[1].review_attempts, 2);
});

test('technical review failure retries the same stored asset without generation', async () => {
  const queue = queueRecorder();
  let generations = 0;
  const job = { ...baseJob, status: 'review_pending', candidate_image_url: 'https://storage.example/candidate.jpg' };
  const result = await processImageRepairJob({}, queue, job, {
    generate: async () => { generations += 1; throw new Error('must not generate'); },
    fetchImpl: async () => new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64'), { status: 200 }),
    validate: async () => { throw new Error('review service unavailable'); },
  });
  assert.equal(result.status, 'review_failed');
  assert.equal(result.reusedCandidate, true);
  assert.equal(generations, 0);
  assert.equal(queue.calls[0][0], 'review');
});

test('a preserved candidate can later pass review and transition to accepted', async () => {
  const queue = queueRecorder();
  const { article, client } = articleClient();
  const job = { ...baseJob, status: 'review_pending', candidate_image_url: 'https://storage.example/candidate.jpg' };
  const result = await reviewStoredCandidate(client, queue, job, {
    fetchImpl: async () => new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64'), { status: 200 }),
    validate: async () => ({ acceptable: true, issues: [], correction: '' }),
  });
  assert.equal(result.status, 'accepted');
  assert.equal(article.image_url, job.candidate_image_url);
  assert.equal(queue.calls.at(-1)[0], 'accepted');
});

test('retry backoff is bounded at 24 hours', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  assert.equal(nextAttempt(0, now), '2026-10-04T13:00:00.000Z');
  assert.equal(nextAttempt(20, now), '2026-10-05T12:00:00.000Z');
});

test('automatic generation, provider, and review retry budgets are finite', () => {
  assert.ok(MAX_GENERATION_ATTEMPTS > 0 && MAX_GENERATION_ATTEMPTS <= 20);
  assert.ok(MAX_PROVIDER_FAILURES > 0 && MAX_PROVIDER_FAILURES <= 20);
  assert.ok(MAX_REVIEW_ATTEMPTS > 0 && MAX_REVIEW_ATTEMPTS <= 20);
});
