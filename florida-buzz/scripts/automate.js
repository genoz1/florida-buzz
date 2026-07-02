require('dotenv').config();
const Parser = require('rss-parser');
const { supabase, storeGeneratedImage } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateArticleImage } = require('../lib/imageGen');
const { createPin } = require('../lib/pinterest');
const SOURCES = require('./sources');

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});
const DRY_RUN = process.env.DRY_RUN === 'true';

function extractImage(item) {
  if (item.enclosure?.url && item.enclosure.type?.startsWith('image')) {
    return item.enclosure.url;
  }
  if (Array.isArray(item.mediaContent) && item.mediaContent[0]?.$?.url) {
    return item.mediaContent[0].$.url;
  }
  if (item.mediaThumbnail?.$?.url) {
    return item.mediaThumbnail.$.url;
  }
  const html = item.content || item['content:encoded'] || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

const KNOWN_SOURCE_NAMES = {
  'disneyparksblog.com': 'Disney Parks Blog',
  'disneytouristblog.com': 'Disney Tourist Blog',
  'blogmickey.com': 'BlogMickey',
  'wdwmagic.com': 'WDW Magic',
  'disneyfoodblog.com': 'Disney Food Blog',
  'universalorlandoblog.com': 'Universal Orlando Blog',
  'nasa.gov': 'NASA',
};

function nameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (KNOWN_SOURCE_NAMES[host]) return KNOWN_SOURCE_NAMES[host];
    const base = host.split('.')[0];
    return base
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch {
    return 'Unknown Source';
  }
}

async function isAppropriate(title, summary) {
  const system = `You screen news items for The Florida Buzz, a lighthearted Florida
lifestyle and travel site. Answer ONLY "YES" or "NO" — nothing else.
Answer NO for: deaths, fatal accidents or attacks, violent crime, sexual assault,
active criminal cases or trials, disasters with casualties, or anything involving
serious harm to a real named person.
Answer YES for: theme park news, travel deals, wildlife sightings/conservation,
weather, festivals, food, beaches, cruises, space launches — the normal, upbeat
local news and lifestyle content this site covers.
When genuinely unsure, answer NO — it's better to skip a borderline story than
publish something insensitive.`;

  const user = `Headline: ${title}\nSummary: ${summary}`;

  try {
    const raw = await askClaude(system, user, 10);
    return raw.trim().toUpperCase().startsWith('YES');
  } catch (err) {
    console.error(`  [error] Safety check failed, skipping item to be safe: ${err.message}`);
    return false;
  }
}

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
  "fb_caption": "string, Facebook post: 1-2 punchy sentences plus a relevant emoji, ends with 'Full story \\u2193' — no hashtags",
  "pin_title": "string, under 100 characters, descriptive and keyword-rich (Pinterest is a search engine, not a feed — favor clarity over punchiness)",
  "pin_description": "string, 1-2 sentences, under 500 characters, naturally including relevant search terms a Florida traveler might type (e.g. category, location, activity) without keyword-stuffing"
}`;

  const user = `Source: ${sourceName}
Original headline: ${sourceTitle}
Source summary/content: ${sourceSummary}
Category: ${category}
Source link (for context only, do not include in body_html): ${sourceUrl}`;

  const raw = await askClaude(system, user, 1200);
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
    console.error(`  [debug] Raw response was not valid JSON: "${cleaned.slice(0, 150)}..."`);
    throw new Error('Could not parse a valid article from the AI response');
  }
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

async function postToPinterest({ pin_title, pin_description, slug, imageUrl }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] Would create Pin: "${pin_title}"`);
    return true;
  }
  if (!process.env.PINTEREST_ACCESS_TOKEN || !process.env.PINTEREST_BOARD_ID) {
    console.log('  [skip] PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID not set — skipping Pinterest.');
    return false;
  }
  if (!imageUrl) {
    console.log('  [skip] No image available for this article — Pinterest requires one, skipping.');
    return false;
  }

  const articleUrl = `${process.env.SITE_URL}/article/${slug}`;

  try {
    await createPin({
      imageUrl,
      title: pin_title,
      description: pin_description,
      link: articleUrl,
    });
    return true;
  } catch (err) {
    console.error(`  [error] Pinterest post failed: ${err.message}`);
    return false;
  }
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

    const item = feed.items[0];
    const guid = item.guid || item.link;

    if (await alreadySeen(guid)) {
      console.log(`  Already covered: "${item.title}"`);
      continue;
    }

    console.log(`  New item: "${item.title}" — checking content...`);
    const summary = item.contentSnippet || item.content || item.title;
    const ok = await isAppropriate(item.title, summary);
    if (!ok) {
      console.log(`  [skip] Flagged as not a fit for the site's tone — skipping.`);
      await markSeen(guid);
      continue;
    }

    console.log(`  Writing article...`);
    const actualSourceName = source.mixedSource ? nameFromUrl(item.link) : source.name;
    const realImage = extractImage(item);
    let article;
    try {
      article = await writeArticle({
        sourceTitle: item.title,
        sourceSummary: summary,
        sourceName: actualSourceName,
        sourceUrl: item.link,
        category: source.category,
      });
    } catch (err) {
      console.error(`  [error] AI writing failed: ${err.message}`);
      await markSeen(guid); // don't retry forever — this item likely has too little content to ever succeed
      continue;
    }

    const slug = `${slugify(article.title)}-${Date.now().toString(36)}`;

    let finalImage;
    if (source.preferAI) {
      console.log(`  This source is set to always use AI images — generating...`);
      finalImage = DRY_RUN ? null : await generateArticleImage({ title: article.title, category: source.category, slug });
    } else if (realImage) {
      console.log(`  Using real photo from source article.`);
      finalImage = realImage;
    } else {
      console.log(`  No real photo found — generating one...`);
      finalImage = DRY_RUN ? null : await generateArticleImage({ title: article.title, category: source.category, slug });
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Title: ${article.title}`);
      console.log(`  [dry-run] Dek: ${article.dek}`);
      console.log(`  [dry-run] Image: ${source.preferAI ? '(would generate — preferAI is set)' : realImage ? 'real photo found' : '(would generate — no real photo, skipped in dry-run)'}`);
      console.log(`  [dry-run] FB caption: ${article.fb_caption}`);
      console.log(`  [dry-run] Pin title: ${article.pin_title}`);
      console.log(`  [dry-run] Pin description: ${article.pin_description}`);
    } else if (supabase) {
      const { error } = await supabase.from('articles').insert({
        slug,
        title: article.title,
        dek: article.dek,
        body_html: article.body_html,
        category: source.category,
        source_name: actualSourceName,
        source_url: item.link,
        image_url: finalImage,
        fb_caption: article.fb_caption,
      });
      if (error) {
        console.error(`  [error] Could not save article: ${error.message}`);
        continue;
      }
      console.log(`  Saved article: /article/${slug}`);
    }

    await postToFacebook({ title: article.title, fb_caption: article.fb_caption, slug });
    await postToPinterest({ pin_title: article.pin_title, pin_description: article.pin_description, slug, imageUrl: finalImage });
    await markSeen(guid);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exit(1);
});
