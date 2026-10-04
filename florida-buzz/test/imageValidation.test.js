const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = 'test-key-not-a-secret';

const { validateGeneratedImage } = require('../lib/imageValidation');
const { generateValidatedImage, generateValidatedImageResult } = require('../lib/imageGen');

const context = { title: 'Magic Kingdom entrance update', location: 'Magic Kingdom', slug: 'entrance-update' };
const bytes = Buffer.from('mock-png-bytes');

test('review sends the actual image at high detail and accepts a clean completed verdict', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ acceptable: true, relevance_acceptable: true, issues: [], correction: '' }) }] }] }), { status: 200 });
  };
  assert.deepEqual(await validateGeneratedImage(bytes, { ...context, imagePrompt: 'Editorial photo' }), {
    acceptable: true, relevanceAcceptable: true, issues: [], correction: '',
  });
  assert.equal(body.input[0].content[1].image_url, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(body.input[0].content[1].detail, 'high');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.max_output_tokens, 2000);
  assert.match(body.instructions, /semantic relevance/i);
  assert.match(body.instructions, /Reject clear visible defects or material inaccuracies/);
  assert.match(body.instructions, /Do not reject solely\s+because a minor background detail cannot be verified/);
  assert.match(body.instructions, /generic beach, mountain, sunset,\s*forest or generic attraction scene is not relevant/i);
  assert.match(body.instructions, /landmarks belonging to\s*another destination/i);
});

test('production token exhaustion stays a technical failure with safe diagnostic details', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  global.fetch = async () => new Response(JSON.stringify({
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    usage: { output_tokens: 350, output_tokens_details: { reasoning_tokens: 203 } },
    output: [],
    secret: 'must-not-log',
  }));
  await assert.rejects(validateGeneratedImage(bytes, context), (error) => {
    assert.equal(error.message, 'Image review did not complete (status=incomplete, incomplete_reason=max_output_tokens).');
    assert.doesNotMatch(error.message, /must-not-log/);
    return true;
  });
  global.fetch = async () => new Response(JSON.stringify({
    status: 'untrusted-status-secret', incomplete_details: { reason: 'untrusted-reason-secret' },
  }));
  await assert.rejects(validateGeneratedImage(bytes, context), /status=unknown, incomplete_reason=unknown/);
});

test('completed empty and malformed API review output is never accepted', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  for (const output_text of ['', '{broken', '{}', 'null']) {
    global.fetch = async () => new Response(JSON.stringify({ status: 'completed', output_text }));
    await assert.rejects(validateGeneratedImage(bytes, context));
  }
});

test('wrong-location and generic imagery remain strict relevance failures', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  const failures = [
    { issues: ['Generic beach does not depict the named park'], correction: 'Show the named park' },
    { issues: ['Recognizable landmark belongs to another destination'], correction: 'Use the correct Florida location' },
  ];
  global.fetch = async () => new Response(JSON.stringify({
    status: 'completed',
    output_text: JSON.stringify({
      acceptable: false,
      relevance_acceptable: false,
      ...failures.shift(),
    }),
  }), { status: 200 });

  for (const imagePrompt of ['Generic attractive beach', 'Landmark from the wrong park']) {
    const review = await validateGeneratedImage(bytes, {
      title: 'Named Florida park update',
      subject: 'Named Florida park',
      location: 'Orlando, Florida',
      entities: ['Named Florida park'],
      category: 'theme-parks',
      imagePrompt,
    });
    assert.equal(review.acceptable, false);
    assert.equal(review.relevanceAcceptable, false);
  }
});

test('bad anatomy triggers one corrected generation; only the approved replacement is stored', async () => {
  const prompts = [];
  const stored = [];
  const verdicts = [
    { acceptable: false, relevanceAcceptable: true, issues: ['Children face backward; stroller is pulled'], correction: 'Remove the stroller and show the empty entrance' },
    { acceptable: true, relevanceAcceptable: true, issues: [], correction: '' },
  ];
  const result = await generateValidatedImage('Actual park entrance', context, {
    generate: async (prompt) => { prompts.push(prompt); return Buffer.from(`image-${prompts.length}`); },
    validate: async () => verdicts.shift(),
    store: async (buffer, filename) => { stored.push({ buffer: buffer.toString(), filename }); return 'stored-url'; },
  });
  assert.equal(result, 'stored-url');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Adults must push strollers from behind/);
  assert.match(prompts[1], /Remove the stroller and show the empty entrance/);
  assert.deepEqual(stored, [
    { buffer: 'image-1', filename: 'entrance-update.png' },
    { buffer: 'image-2', filename: 'entrance-update.png' },
  ]);
});

test('two rejected images leave no stored hero image', async () => {
  let generations = 0;
  let stores = 0;
  const result = await generateValidatedImage('Actual park entrance', context, {
    generate: async () => { generations += 1; return bytes; },
    validate: async () => ({ acceptable: false, relevanceAcceptable: true, issues: ['Impossible stroller geometry'], correction: 'Exclude stroller' }),
    store: async () => { stores += 1; return 'must-not-store'; },
  });
  assert.equal(result, null);
  assert.equal(generations, 2);
  assert.equal(stores, 2);
});

test('review errors, incomplete responses, and contradictory verdicts fail closed', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  global.fetch = async () => new Response(JSON.stringify({ status: 'incomplete' }), { status: 200 });
  await assert.rejects(validateGeneratedImage(bytes, { ...context, imagePrompt: 'Photo' }), /did not complete/);

  global.fetch = async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ acceptable: true, relevance_acceptable: true, issues: ['Malformed hands'], correction: '' }) }), { status: 200 });
  assert.equal((await validateGeneratedImage(bytes, { ...context, imagePrompt: 'Photo' })).acceptable, false);

  global.fetch = async () => new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ acceptable: true, relevance_acceptable: false, issues: ['Generic beach does not depict SeaWorld Orlando'], correction: 'Show a credible SeaWorld Orlando setting' }) }), { status: 200 });
  const irrelevant = await validateGeneratedImage(bytes, {
    title: 'SeaWorld Orlando Quick Queue',
    subject: 'SeaWorld Orlando attraction queue',
    location: 'SeaWorld Orlando',
    entities: ['SeaWorld Orlando', 'Quick Queue'],
    category: 'theme-parks',
    imagePrompt: 'A SeaWorld Orlando queue',
  });
  assert.equal(irrelevant.acceptable, false);
  assert.equal(irrelevant.relevanceAcceptable, false);

  let generations = 0;
  let stores = 0;
  assert.equal(await generateValidatedImage('Photo', context, {
    generate: async () => { generations += 1; return bytes; },
    validate: async () => { throw new Error('API outage'); },
    store: async () => { stores += 1; },
  }), null);
  assert.equal(generations, 1);
  assert.equal(stores, 1);
});

test('generation provider failures and timeouts return repairable state instead of throwing', async () => {
  for (const error of [new Error('provider unavailable'), Object.assign(new Error('generation timed out'), { name: 'TimeoutError' })]) {
    const result = await generateValidatedImageResult('Photo', context, {
      generate: async () => { throw error; },
      validate: async () => { throw new Error('must not review'); },
      store: async () => { throw new Error('must not store'); },
    });
    assert.equal(result.status, 'generation_failed');
    assert.equal(result.generationAttempts, 0);
    assert.match(result.error, /provider unavailable|timed out/);
  }
});

test('technical review failure preserves the generated candidate for retry without another generation', async () => {
  let generations = 0;
  const result = await generateValidatedImageResult('Photo', context, {
    generate: async () => { generations += 1; return bytes; },
    store: async () => 'https://storage.example/candidate.jpg',
    validate: async () => { throw new Error('review API unavailable'); },
  });
  assert.equal(result.status, 'review_failed');
  assert.equal(result.candidateUrl, 'https://storage.example/candidate.jpg');
  assert.equal(generations, 1);
});

 test('malformed review decisions preserve candidate without corrective generation', async () => {
  for (const verdict of [undefined, {}, { acceptable: false }, { acceptable: false, issues: [], correction: null }]) {
    let generations = 0;
    const result = await generateValidatedImageResult('Photo', context, {
      generate: async () => { generations++; return bytes; },
      store: async () => 'https://storage.example/same.jpg',
      validate: async () => verdict,
    });
    assert.equal(result.status, 'review_failed');
    assert.equal(result.candidateUrl, 'https://storage.example/same.jpg');
    assert.equal(generations, 1);
  }
});
