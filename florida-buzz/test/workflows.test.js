const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OPENAI_API_KEY = 'test-key-not-a-secret';
process.env.AI_MAX_ATTEMPTS = '1';

const { writeArticle } = require('../scripts/automate');
const { pickTopic, researchAndWriteGuide } = require('../scripts/generate-guide');
const { writeReview } = require('../scripts/submit-review');
const { composeRoundup } = require('../scripts/city-roundup');
const { generateThisOrThat } = require('../scripts/engagement-post');
const { generateCaption } = require('../scripts/promo-feature-post');
const { researchParkDining } = require('../scripts/generate-dining-directory');
const { generateArticleImage } = require('../lib/imageGen');

const body = '<p>Florida travelers have a useful new detail to consider while planning their next visit.</p><p>The update includes practical timing, location, and planning information from the original source.</p><p>Check current details before leaving home so the day goes smoothly.</p>';
const social = {
  fb_caption: 'A specific Florida update is worth a closer look. Full story ↓',
  pin_title: 'Florida Travel Update and Planning Guide',
  pin_description: 'Current Florida travel information for residents and visitors planning a trip.',
};

function responsePayload(text, { research = false } = {}) {
  const output = [];
  if (research) output.push({ type: 'web_search_call', action: { type: 'search' } });
  output.push({ type: 'message', content: [{ type: 'output_text', text }] });
  return { status: 'completed', output };
}

function queueFetch(payloads, requests) {
  return async (url, options = {}) => {
    requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    const next = payloads.shift();
    assert.ok(next, `Unexpected request to ${url}`);
    if (next.image) {
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('mock-image').toString('base64') }] }), { status: 200 });
    }
    return new Response(JSON.stringify(responsePayload(JSON.stringify(next.value), { research: next.research })), { status: 200 });
  };
}

test('all Florida Buzz text workflows retain their existing structured contracts', async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  const payloads = [
    { value: { title: 'Florida Attraction Announces a Helpful Update', meta_title: 'Florida Attraction Update 2026', category: 'theme-parks', dek: 'A concise explanation of what visitors should know.', body_html: body, ...social } },
    { research: true, value: { topic: 'Current Florida park entry procedures', working_title: 'Florida Park Entry Procedures Guide' } },
    { research: true, value: { title: 'Florida Park Entry Procedures Guide', dek: 'What to know before arriving at the gate.', body_html: body, ...social, fb_caption: 'Plan your next Florida park day with current details. Full guide ↓' } },
    { research: true, value: { title: 'Manual Florida Springs Planning Guide', dek: 'Current planning details for a Florida springs visit.', body_html: body, ...social, fb_caption: 'Plan a Florida springs day with current information. Full guide ↓' } },
    { value: { title: 'My Honest Florida Restaurant Review', meta_title: 'Florida Restaurant Review', dek: 'My firsthand experience and practical verdict.', body_html: body, ...social, fb_caption: 'I reached a specific verdict about this Florida restaurant. Full review ↓' } },
    { value: { title: 'What to Do This Weekend in Orlando', meta_title: 'Orlando Events This Weekend', dek: 'A useful selection of current Orlando events.', body_html: body, fb_caption: 'Orlando has a busy weekend ahead. 🎉' } },
    { value: { topic: 'beach-vs-springs', message: '❤️ for Florida beaches or 👍 for natural springs? React with your pick!' } },
    { value: { message: 'See current Florida attraction waits before choosing your next stop.', pin_title: 'Florida Theme Park Wait Times', pin_description: 'Check current Florida theme park wait times while planning a park day.' } },
    { research: true, value: [{ name: 'Sample Restaurant', land: 'Sample Land', service_type: 'table-service', reservations: 'recommended', dining_plan: null, character_dining: false, characters: null, meal_periods: ['dinner'], description: 'A current table-service option with a practical menu and comfortable setting.' }] },
  ];
  global.fetch = queueFetch(payloads, requests);
  t.after(() => { global.fetch = originalFetch; });

  assert.equal((await writeArticle({ sourceTitle: 'Source headline', sourceSummary: 'Detailed source facts for the story.', sourceName: 'Official source', sourceUrl: 'https://example.com/story', category: 'theme-parks' })).category, 'theme-parks');
  assert.match((await pickTopic('theme-parks', [])).working_title, /Procedures/);
  assert.match((await researchAndWriteGuide({ category: 'theme-parks', topic: 'Entry procedures', workingTitle: 'Entry guide' })).title, /Entry Procedures/);
  assert.match((await researchAndWriteGuide({ category: 'beaches', topic: 'Manual topic: springs planning', workingTitle: 'Springs guide' })).title, /Manual/);
  assert.match((await writeReview({ reviewType: 'restaurant', reviewerName: 'Local reviewer', reviewerBackground: 'Frequent visitor', subjectName: 'Sample Restaurant', answers: { standout: 'Friendly service' }, memory: 'A quiet lunch', rating: 4 })).title, /Review/);
  assert.match((await composeRoundup({ cityLabel: 'Orlando', mode: 'weekend', articles: [{ title: 'Local festival', dek: 'A downtown event.', slug: 'local-festival' }] })).title, /Orlando/);
  assert.equal((await generateThisOrThat([])).topic, 'beach-vs-springs');
  assert.match((await generateCaption('wait-times', [])).pin_title, /Wait Times/);
  assert.equal((await researchParkDining('Sample Florida Park'))[0].name, 'Sample Restaurant');
  assert.equal(payloads.length, 0);
  assert.equal(requests.filter((request) => request.body?.tool_choice === 'required').length, 4);
});

test('the image path still uses a text prompt followed by gpt-image-1 and fails closed', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  const requests = [];
  global.fetch = queueFetch([{ value: 'A warm, generic Florida springs scene without logos.' }, { image: true }], requests);
  assert.equal(await generateArticleImage({ title: 'Florida Springs Planning Update', category: 'florida-living', slug: 'springs-update' }), null);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[1].url, 'https://api.openai.com/v1/images/generations');
  assert.equal(requests[1].body.model, 'gpt-image-1');

  const failedRequests = [];
  global.fetch = async (url, options = {}) => {
    failedRequests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/responses')) {
      return new Response(JSON.stringify(responsePayload('A safe generic Florida image prompt.')), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: 'temporary image failure' } }), { status: 500 });
  };
  assert.equal(await generateArticleImage({ title: 'Florida Beach Update', category: 'beaches', slug: 'beach-update' }), null);
  assert.equal(failedRequests.length, 2);
});
