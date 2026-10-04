const test = require('node:test');
const assert = require('node:assert/strict');
const { Jimp } = require('jimp');
const { createImageRepairQueue, generationLimit } = require('../lib/imageRepairQueue');
const { runImageRepairBatch } = require('../lib/imageRepairWorkflow');
const { generateValidatedImageResult } = require('../lib/imageGen');
const { inspectStoredImage } = require('../scripts/repair-article-images');

function fixture() {
  const article = { id: 'target-id', slug: 'disney-world-hispanic-heritage-month-2026', title: 'Disney World Hispanic Heritage', image_url: null };
  let repair = { article_id: article.id, article_slug: article.slug, status: 'needs_manual', generation_attempts: 4,
    provider_failures: 0, review_attempts: 4, image_context: {}, candidate_image_url: null,
    last_error: 'Maximum automatic generation attempts reached.', next_attempt_at: '2026-10-01T00:00:00Z' };
  const client = { from(table) {
    let filters = [], patch;
    const records = () => (table === 'articles' ? [article] : [repair]).filter((r) => filters.every((f) => f(r)));
    const chain = {
      select() { return chain; }, order() { return chain; }, limit() { return chain; },
      eq(field, value) { filters.push((r) => r[field] === value); return chain; },
      is(field, value) { return chain.eq(field, value); },
      in(field, values) { filters.push((r) => values.includes(r[field])); return chain; },
      update(values) { patch = values; return chain; },
      async upsert(values) { repair = { ...repair, ...values }; return {}; },
      async maybeSingle() { const matched = records(); if (patch) matched.forEach((r) => Object.assign(r, patch)); return { data: matched[0] || null }; },
      then(resolve, reject) { if (patch) records().forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: records() }).then(resolve, reject); },
    };
    return chain;
  } };
  return { article, client, repair: () => repair };
}

test('legacy recovery → rejection → backed-off targeted retry → acceptance → attachment → good audit', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T22:30:00Z') });
  const f = fixture();
  const queue = createImageRepairQueue(f.client);
  const image = await new Jimp({ width: 800, height: 600, color: 0xffcc88ff }).getBuffer('image/png');
  let generations = 0, reviews = 0, priorCorrection;
  const logs = [];
  const correction = 'Use a more photorealistic Disney World celebration scene with naturally detailed decorations and people.';
  const options = { slugs: [f.article.slug], recoverLegacy: true, limit: 1,
    logger: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
    generate: async (article, opts) => {
      priorCorrection = opts.priorCorrection;
      return generateValidatedImageResult('Editorial celebration scene', { slug: article.slug }, {
        ...opts,
        generate: async () => { generations++; return image; },
        validate: async () => { reviews++; return generations === 1
          ? { acceptable: false, issues: ['Visibly synthetic decorations and people'], correction }
          : { acceptable: true, issues: [], correction: '' }; },
      });
    },
    store: async () => `https://storage.example/image-${generations}.png`,
  };
  await queue.enqueue(f.article);
  const [first] = await runImageRepairBatch(f.client, options);
  assert.equal(first.status, 'rejected');
  assert.equal(f.repair().status, 'pending');
  assert.equal(f.repair().generation_attempts, 5);
  assert.equal(generationLimit(f.repair()), 6);
  const next = f.repair().next_attempt_at;
  assert.equal(next, '2026-10-05T22:30:00.000Z');
  await queue.enqueue(f.article);
  const [second] = await runImageRepairBatch(f.client, options);
  assert.equal(second.status, 'deferred_backoff');
  assert.equal(second.nextAttemptAt, next);
  assert.equal(generations, 1);
  assert.equal(reviews, 1);
  assert.equal(f.repair().next_attempt_at, next);
  assert.equal(generationLimit(f.repair()), 6);
  assert.match(logs.at(-1), /eligible at .*no generation or review performed/);
  t.mock.timers.setTime(new Date(next).getTime());
  await queue.enqueue(f.article);
  const [third] = await runImageRepairBatch(f.client, options);
  assert.equal(priorCorrection, correction);
  assert.equal(third.status, 'accepted');
  assert.equal(f.repair().status, 'accepted');
  assert.equal(f.article.image_url, 'https://storage.example/image-2.png');
  assert.equal(f.repair().generation_attempts, 6);
  assert.equal(generations, 2);
  assert.equal(reviews, 2);
  const audit = await inspectStoredImage(f.article, async () => new Response(image));
  assert.equal(audit.issue, null);
  const [fourth] = await runImageRepairBatch(f.client, options);
  assert.equal(fourth.status, 'already_repaired');
  assert.equal(generations, 2);
});

test('a second genuine rejection exhausts recovery permanently without resetting history', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T22:30:00Z') });
  const f = fixture();
  let generations = 0;
  const options = { slugs: [f.article.slug], recoverLegacy: true, limit: 1,
    logger: { log() {}, error() {} },
    generate: async (_article, opts) => {
      assert.equal(opts.maxAttempts, 1);
      generations++;
      return { status: 'rejected', candidateUrl: 'https://storage.example/rejected.png', generationAttempts: 1,
        reviewAttempts: 1, correction: 'Obvious synthetic artifacts' };
    },
  };
  await runImageRepairBatch(f.client, options);
  t.mock.timers.setTime(new Date(f.repair().next_attempt_at).getTime());
  await runImageRepairBatch(f.client, options);
  assert.equal(f.repair().status, 'needs_manual');
  assert.equal(f.repair().generation_attempts, 6);
  const [again] = await runImageRepairBatch(f.client, options);
  assert.equal(again.status, 'needs_manual');
  assert.equal(generations, 2);
  assert.equal(generationLimit(f.repair()), 6);
  assert.equal(f.article.image_url, null);
});

test('invalid persisted retry time fails closed without generation or review', async () => {
  const f = fixture();
  Object.assign(f.repair(), { status: 'pending', next_attempt_at: 'invalid timestamp' });
  const [result] = await runImageRepairBatch(f.client, { slugs: [f.article.slug], limit: 1,
    logger: { log() {}, error() {} },
    generate: async () => { throw new Error('must not generate'); },
    validate: async () => { throw new Error('must not review'); },
  });
  assert.equal(result.status, 'invalid_retry_time');
  assert.equal(f.repair().generation_attempts, 4);
});
