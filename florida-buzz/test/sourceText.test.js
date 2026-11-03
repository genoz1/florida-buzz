const test=require('node:test');
const assert=require('node:assert/strict');
const {extractSourceText,feedEvidence,selectArticleEvidence}=require('../lib/sourceText');

test('long site chrome cannot displace the source article before the prompt cap',()=>{
  const facts='Korean barbecue is served at the named restaurant. '.repeat(10);
  const text=extractSourceText('<nav>'+('Menu '.repeat(2500))+'</nav><aside>Unrelated teaser</aside><article><h1>Food update</h1><p>'+facts+'</p></article><footer>Subscribe</footer>');
  assert.ok(text.includes(facts.trim()));assert.ok(!text.includes('Menu'));assert.ok(!text.includes('Unrelated teaser'));
});
test('a teaser is not padded with unrelated site text',()=>{
  assert.equal(extractSourceText('<article><p>Read more to see the eight dishes.</p></article><div>'+('Other stories '.repeat(100))+'</div>'),null);
});
test('a complete feed takes precedence over its shortened snippet',()=>{
  const item={title:'Eight dishes',contentSnippet:'Eight new dishes are coming.',content:'<p>The eight actual names.</p>'};
  assert.equal(feedEvidence(item),item.content);
  item['content:encoded']='<p>The complete original feed article.</p>';
  assert.equal(feedEvidence(item),item['content:encoded']);
});

test('a missing source page and headline-only feed cannot supply article evidence',()=>{
  const title='Park announces new opening hours';
  assert.equal(selectArticleEvidence({title},null),null);
  assert.equal(selectArticleEvidence({title,contentSnippet:title},null),null);
  assert.equal(selectArticleEvidence({title,content:'<p>'+title+'</p><a href="/story">Read more</a>'},null),null);
  assert.equal(selectArticleEvidence({title:'Boats & beaches',content:'<p>Boats &#38; beaches</p>'},null),null);
});

test('a real short report remains eligible and full source material takes priority',()=>{
  const item={title:'Park announces new opening hours',content:'<p>Gates open at 8 a.m. on Saturday.</p>'};
  assert.equal(selectArticleEvidence(item,null),item.content);
  assert.equal(selectArticleEvidence(item,'Full article with confirmed operating details.'),'Full article with confirmed operating details.');
  item['content:encoded']=item.title;
  assert.equal(selectArticleEvidence(item,null),item.content);
});
