const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageRepairQueue, MAX_REVIEW_ATTEMPTS, MAX_GENERATION_ATTEMPTS } = require('../lib/imageRepairQueue');
const { processImageRepairJob } = require('../lib/imageRepairWorkflow');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64');
const article = { id: 'test-id', slug: 'test-slug', title: 'Universal Orlando refill cups' };
function fixture() {
  let clock = new Date('2026-10-04T12:00:00Z');
  let row = { article_id: article.id, article_slug: article.slug, status: 'review_pending',
    candidate_image_url: 'https://storage.example/original.png', next_attempt_at: '2026-10-04T16:00:00.000Z',
    generation_attempts: 2, review_attempts: 1, provider_failures: 0 };
  const client = { from(table) {
    assert.equal(table, 'article_image_repairs');
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: { ...row } }),
      in: (_field, statuses) => { chain.statuses = statuses; return chain; },
      lte: (_field, date) => { chain.date = date; return chain; },
      order: () => chain,
      limit: async () => ({ data: chain.statuses.includes(row.status) && row.next_attempt_at <= chain.date ? [{ ...row }] : [] }),
      upsert: async (values) => { row = { ...row, ...values }; return {}; },
      update: (values) => ({ eq: async () => { row = { ...row, ...values }; return {}; } }),
    };
    return chain;
  } };
  return { client, queue: createImageRepairQueue(client, { now: () => clock }),
    row: () => ({ ...row }), advance: () => { clock = new Date(row.next_attempt_at); } };
}

test('audit refresh preserves review state, candidate, attempts, and backoff; due job only reviews', async () => {
  const f = fixture();
  const original = f.row();
  await f.queue.enqueue(article);
  for (const field of ['status', 'candidate_image_url', 'next_attempt_at', 'generation_attempts', 'review_attempts']) {
    assert.equal(f.row()[field], original[field]);
  }
  assert.deepEqual(await f.queue.loadDue(), []);
  f.advance();
  let generations = 0;
  const fetched = [];
  for (const failure of [new Error('Image review did not complete'), new Error('timeout'), new Error('provider API error'), null]) {
    const [job] = await f.queue.loadDue();
    const result = await processImageRepairJob({}, f.queue, job, {
      generate: async () => { generations++; throw new Error('must not generate'); },
      fetchImpl: async (url) => { fetched.push(url); return new Response(png); },
      validate: async () => { if (failure) throw failure; return undefined; },
    });
    assert.equal(result.status, 'review_failed');
    const beforeRefresh = f.row();
    await f.queue.enqueue(article);
    assert.equal(f.row().next_attempt_at, beforeRefresh.next_attempt_at);
    assert.equal(f.row().candidate_image_url, original.candidate_image_url);
    assert.equal(f.row().status, 'review_pending');
    f.advance();
  }
  assert.equal(generations, 0);
  assert.deepEqual(fetched, Array(4).fill(original.candidate_image_url));
});

test('missing and corrupt candidates allow a later generation; transient fetch errors preserve them', async () => {
  for (const response of [() => new Response('', { status: 404 }), () => new Response('not image'), () => new Response('', { status: 503 })]) {
    const f = fixture();
    await processImageRepairJob({}, f.queue, f.row(), { fetchImpl: async () => response() });
    if (f.row().status === 'pending') {
      assert.equal(f.row().candidate_image_url, null);
      let calls = 0;
      await processImageRepairJob({}, f.queue, f.row(), { generate: async () => { calls++; return { status: 'generation_failed' }; } });
      assert.equal(calls, 1);
    } else {
      assert.equal(f.row().status, 'review_pending');
      assert.ok(f.row().candidate_image_url);
    }
  }
});

test('completed rejection permits corrective generation', async () => {
  const f = fixture();
  await processImageRepairJob({}, f.queue, f.row(), {
    fetchImpl: async () => new Response(png),
    validate: async () => ({ acceptable: false, issues: ['Wrong park'], correction: 'Show Universal Orlando' }),
  });
  assert.equal(f.row().status, 'pending');
  assert.equal(f.row().candidate_image_url, null);
  let generated = 0;
  await processImageRepairJob({}, f.queue, f.row(), { generate: async (_article, options) => {
    generated++;
    assert.equal(options.maxAttempts, 2);
    assert.equal(options.priorCorrection, 'Show Universal Orlando');
    return { status: 'generation_failed' };
  } });
  assert.equal(generated, 1);
});

test('exhausted review and generation safeguards survive audit refresh', async () => {
  const f = fixture();
  await f.queue.markReviewFailure({ ...f.row(), review_attempts: MAX_REVIEW_ATTEMPTS - 1 }, new Error('timeout'));
  const exhausted = f.row();
  await f.queue.enqueue(article);
  assert.equal(f.row().status, 'needs_manual');
  assert.equal(f.row().next_attempt_at, exhausted.next_attempt_at);
  assert.equal(f.row().candidate_image_url, exhausted.candidate_image_url);
  assert.deepEqual(await f.queue.loadDue(), []);
  let calls = 0;
  await processImageRepairJob({}, f.queue, { ...f.row(), status: 'pending', generation_attempts: MAX_GENERATION_ATTEMPTS }, {
    generate: async () => { calls++; },
  });
  assert.equal(calls, 0);
  assert.equal(f.row().status, 'needs_manual');
});
