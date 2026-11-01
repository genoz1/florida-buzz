const test = require('node:test');
const assert = require('node:assert/strict');
const { appendGuideSources } = require('../lib/guideSources');
const { getExistingGuides } = require('../scripts/generate-guide');

const url = 'https://disneyworld.disney.go.com/guest-services/early-entry/';
const guide = () => ({
  body_html: `<p>Check eligibility on <a href="${url}">Disney's early entry page</a>.</p>`,
  sources: [{ title: 'Early entry', url }],
});

test('published sources must be consulted URLs and safely rendered, with supporting inline links', () => {
  const html = appendGuideSources(guide(), [{ url, title: 'Rules <and> "eligibility"' }]);
  assert.match(html, /Sources used for this guide/);
  assert.match(html, /Rules &lt;and&gt; &quot;eligibility&quot;/);
  assert.match(html, /rel="noopener"/);
  assert.throws(() => appendGuideSources(guide(), []), /not returned/);
  assert.throws(() => appendGuideSources({ ...guide(), sources: [{ title: 'invented', url: url + 'invented' }] }, [{ url }]), /not returned/);
  assert.throws(() => appendGuideSources({ ...guide(), body_html: '<p>A rule with no supporting link.</p>' }, [{ url }]), /beside its factual claims/);
  assert.throws(() => appendGuideSources({ ...guide(), body_html: '<p><a href="https://example.com/invented">Unverified rule</a></p>' }, [{ url }]), /external link/);
  assert.throws(() => appendGuideSources({ ...guide(), sources: [{ title: 'unsafe', url: 'javascript:alert(1)' }] }, [{ url: 'javascript:alert(1)' }]), /not returned/);
});

test('tracking differences do not reject a consulted source, while meaningful query differences do', () => {
  const draft = guide();
  draft.sources[0].url += '?utm_source=feed#section';
  draft.body_html = `<p><a href="${url}?utm_campaign=trip">Official eligibility</a> applies.</p>`;
  assert.doesNotThrow(() => appendGuideSources(draft, [{ url }]));
  draft.sources[0].url = url + '?program=other';
  assert.throws(() => appendGuideSources(draft, [{ url }]), /not returned/);
});

test('topic selection sees older guides beyond both the former 200 limit and a database batch', async () => {
  const rows = Array.from({ length: 503 }, (_, i) => ({ slug: 'guide-' + i, title: 'Guide ' + i, category: 'theme-parks', dek: 'Details.' }));
  const ranges = [];
  const client = { from() {
    return { select() { return this; }, eq() { return this; }, order() { return this; },
      async range(from, to) { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; } };
  } };
  const catalog = await getExistingGuides(client);
  assert.equal(catalog.length, 503);
  assert.equal(catalog[502].slug, 'guide-502');
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
  await assert.rejects(() => getExistingGuides(null), /without the existing guide catalog/);
});
