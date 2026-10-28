const test = require('node:test');
const assert = require('node:assert/strict');
const {createSitemapBuilder,SITEMAP_CACHE_TTL_MS} = require('../lib/sitemapBuilder');

test('index and concurrent child requests share a complete cached snapshot', async () => {
  let calls=0, clock=0, release;
  const pending=new Promise(resolve=>{release=resolve;});
  const builder=createSitemapBuilder({now:()=>clock,fetchArticles:async()=>{
    calls++; if(calls===1)await pending;
    return [{slug:'complete-guide',title:'Complete guide',published_at:'2026-10-01'}];
  }});
  const requests=Array.from({length:10},()=>builder.getBundle());
  release();
  const results=await Promise.all(requests);
  assert.equal(calls,1);
  for(const result of results){assert.equal(result.ok,true);assert.match(result.bundle.articleXml[0],/complete-guide/);}
  await builder.getBundle();assert.equal(calls,1);
  clock=SITEMAP_CACHE_TTL_MS+1;
  await builder.getBundle();assert.equal(calls,2);
});

test('a failed cold sitemap build can recover on the next request', async () => {
  let calls=0;
  const builder=createSitemapBuilder({fetchArticles:async()=>{
    if(++calls===1)throw new Error('temporary outage');
    return [{slug:'recovered',title:'Recovered'}];
  }});
  assert.equal((await builder.getBundle()).ok,false);
  const recovered=await builder.getBundle();
  assert.equal(recovered.ok,true);assert.match(recovered.bundle.articleXml[0],/recovered/);
});
