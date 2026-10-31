'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { PGlite } = require('@electric-sql/pglite');
const { lastmodForArticle } = require('../lib/sitemapBuilder');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261031161427_article_content_modified_at.sql'), 'utf8');

test('content edits get modification dates; inserts and social-status updates do not', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.articles (slug text primary key, title text, dek text, body_html text, meta_title text, published_at timestamptz, fb_posted boolean default false);');
    await db.exec(migration);
    await db.exec("insert into public.articles(slug,title,dek,body_html,meta_title,published_at) values ('a','Title','Summary','<p>Original</p>','Meta','2026-07-01T00:00:00Z');");
    let result = await db.query("select content_updated_at from public.articles where slug='a'");
    assert.equal(result.rows[0].content_updated_at, null);
    await db.exec("update public.articles set fb_posted=true where slug='a'");
    result = await db.query("select content_updated_at from public.articles where slug='a'");
    assert.equal(result.rows[0].content_updated_at, null);
    await db.exec("update public.articles set body_html='<p>Corrected facts</p>' where slug='a'");
    result = await db.query("select content_updated_at,published_at from public.articles where slug='a'");
    const modified = result.rows[0].content_updated_at;
    assert.ok(modified instanceof Date);
    assert.equal(result.rows[0].published_at.toISOString(), '2026-07-01T00:00:00.000Z');
    await db.exec("update public.articles set fb_posted=false, title=title where slug='a'");
    result = await db.query("select content_updated_at from public.articles where slug='a'");
    assert.equal(result.rows[0].content_updated_at.toISOString(), modified.toISOString());
    await db.exec(migration);
    result = await db.query("select content_updated_at from public.articles where slug='a'");
    assert.equal(result.rows[0].content_updated_at.toISOString(), modified.toISOString());
  } finally { await db.close(); }
});

test('sitemap and article structured data use actual content dates without changing publication dates', async () => {
  const article = { slug: 'date-test', title: 'Planning facts', dek: 'Useful details', body_html: '<p>Details</p>', category: 'theme-parks', source_name: 'Florida Buzz', source_url: 'https://example.com', published_at: '2026-07-01T12:00:00.000Z', content_updated_at: '2026-10-31T16:00:00.000Z' };
  const locals = { article, related: [], ticker: [], categoryLabels: {}, thumbUrl: u => u, resizeImg: u => u, placeholderImg: () => '/placeholder.svg', timeAgo: () => 'July 1, 2026' };
  const template = path.join(__dirname, '../views/article.ejs');
  function data(html) {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).find(x => x['@type'] === 'NewsArticle');
  }
  const rendered = data(await ejs.renderFile(template, locals));
  assert.equal(rendered.datePublished, article.published_at);
  assert.equal(rendered.dateModified, article.content_updated_at);
  assert.equal(lastmodForArticle(article), '2026-10-31');
  article.content_updated_at = null;
  const unchanged = data(await ejs.renderFile(template, locals));
  assert.equal(unchanged.dateModified, article.published_at);
  assert.equal(lastmodForArticle(article), '2026-07-01');
});
