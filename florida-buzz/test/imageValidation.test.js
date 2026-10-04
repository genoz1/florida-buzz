const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = 'test-key-not-a-secret';

const { validateGeneratedImage } = require('../lib/imageValidation');
const { generateValidatedImage } = require('../lib/imageGen');

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
  assert.match(body.instructions, /semantic relevance/i);
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
  assert.deepEqual(stored, [{ buffer: 'image-2', filename: 'entrance-update.png' }]);
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
  assert.equal(stores, 0);
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
  assert.equal(stores, 0);
});
