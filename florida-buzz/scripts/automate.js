require('dotenv').config();
const Parser = require('rss-parser');
const { supabase } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const SOURCES = require('./sources');

const parser = new Parser({ timeout: 15000 });
const DRY_RUN = process.env.DRY_RUN === 'true';

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

// Asks Claude to write the article body, dek, and a Facebook caption in one call,
// returning structured JSON so we don't need extra parsing logic.
async function writeArticle({ sourceTitle, sourceSummary, sourceName, sourceUrl, category }) {
  const system = `You are a staff writer for The Florida Buzz, a Florida lifestyle and travel news site.
You write original, factual summaries of official press releases and announcements — never copying
the source's wording. Tone: warm, knowledgeable local-insider voice, never breathless or clickbaity.
You ONLY use facts present in the source material. You never invent quotes, dates, or details.
Respond ONLY with valid JSON, no markdown fences, no preamble. Schema:
{
  "title": "string, original headline, under 70 characters",
  "dek": "string, one-sentence subhead, under 140 characters",
  "body_html": "string, 3-5 short paragraphs as <p> tags, original wording, ends with a sentence crediting the source by name",
  "fb_caption": "string, Facebook post: 1-2 punchy sentences plus a relevant emoji, ends with 'Full story \\u2193' — no hashtags"
}`;

  const user = `Source: ${sourceName}
Original headline: ${sourceTitle}
Source summary/content: ${sourceSummary}
Category: ${category}
Source link (for context only, do not include in body_html): ${sourceUrl}`;

  const raw = await askClaude(system, user, 1200);
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

async function postToFacebook({ title, fb_caption, source_url, slug }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] Would post to Facebook: "${fb_caption}"`);
    return true;
  }
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) {
    console.log('  [skip] FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set — skipping Facebook post.');
    return false;
  }

  const articleUrl = `${process.env.SITE_URL}/article/${slug}`;
  const message = `${fb_caption}\n\n${articleUrl}`;

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/feed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        access_token: process.env.FB_PAGE_ACCESS_TOKEN,
      }),
    }
  );

  if (!res.ok) {
    console.error(`  [error] Facebook post failed: ${await res.text()}`);
    return false;
  }
  return true;
}

async function alreadySeen(guid) {
  if (!supabase) return false;
  const { data } = await supabase.from('seen_feed_items').select('id').eq('guid', guid).maybeSingle();
  return !!data;
}

async function markSeen(guid) {
  if (!supabase || DRY_RUN) return;
  await supabase.from('seen_feed_items').insert({ guid });
}

async function run() {
  console.log(`=== The Florida Buzz automation run — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be saved or posted.\n');

  for (const source of SOURCES) {
    console.log(`Checking ${source.name} (${source.category})...`);
    let feed;
    try {
      feed = await parser.parseURL(source.url);
    } catch (err) {
      console.error(`  [error] Could not load feed: ${err.message}`);
      continue;
    }

    if (!feed.items || feed.items.length === 0) {
      console.warn(`  [warn] Feed loaded but had zero items — check the URL.`);
      continue;
    }

    // Only process the single newest item per source per run, to keep volume sane
    // and match the ~8-posts-a-day cadence from the original plan.
    const item = feed.items[0];
    const guid = item.guid || item.link;

    if (await alreadySeen(guid)) {
      console.log(`  Already covered: "${item.title}"`);
      continue;
    }

    console.log(`  New item: "${item.title}" — writing article...`);
    let article;
    try {
      article = await writeArticle({
        sourceTitle: item.title,
        sourceSummary: item.contentSnippet || item.content || item.title,
        sourceName: source.name,
        sourceUrl: item.link,
        category: source.category,
      });
    } catch (err) {
      console.error(`  [error] AI writing failed: ${err.message}`);
      continue;
    }

    const slug = `${slugify(article.title)}-${Date.now().toString(36)}`;

    if (DRY_RUN) {
      console.log(`  [dry-run] Title: ${article.title}`);
      console.log(`  [dry-run] Dek: ${article.dek}`);
      console.log(`  [dry-run] FB caption: ${article.fb_caption}`);
    } else if (supabase) {
      const { error } = await supabase.from('articles').insert({
        slug,
        title: article.title,
        dek: article.dek,
        body_html: article.body_html,
        category: source.category,
        source_name: source.name,
        source_url: item.link,
        fb_caption: article.fb_caption,
      });
      if (error) {
        console.error(`  [error] Could not save article: ${error.message}`);
        continue;
      }
      console.log(`  Saved article: /article/${slug}`);
    }

    await postToFacebook({ title: article.title, fb_caption: article.fb_caption, slug });
    await markSeen(guid);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exit(1);
});
