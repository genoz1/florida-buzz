require('dotenv').config();
const Parser = require('rss-parser');
const { supabase, storeGeneratedImage } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateImage } = require('../lib/openai');
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

// Pulls the real article image out of an RSS item, checking the common places
// feeds put it. Falls back to null, which the site already handles by showing
// a generic category stock photo instead.
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
  // Last resort: pull the first <img> src out of the HTML content, if present.
  const html = item.content || item['content:encoded'] || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

// Writes a DALL-E prompt for the article, and generates + permanently stores the image.
// Deliberately generic/thematic rather than trying to depict the specific real event,
// and explicitly avoids real people, brand logos, and copyrighted characters —
// DALL-E's own content policy blocks most of this anyway, but we ask cleanly up front
// rather than relying on that as the only safeguard.
async function generateArticleImage({ title, category, slug }) {
  const promptSystem = `You write concise, vivid prompts for an AI image generator, for
a Florida lifestyle news site called The Florida Buzz. The image accompanies a news
article but must NOT depict the specific real event, any real named person, or any
copyrighted/trademarked character, logo, or architecture (e.g. no Disney castle, no
Mickey Mouse, no branded theme park attractions by name or unmistakable likeness).

CRITICAL — this must look unmistakably like Florida, not a generic or wrong-region scene:
Florida is famously flat with NO cliffs, NO mountains, NO rocky/pebble beaches, and NO
snow. Correct Florida terrain and features to draw from: flat sandy white or tan beaches,
palm trees, live oaks draped in Spanish moss, mangroves, flat marshland/wetlands,
Everglades-style saw grass, low-rise Florida architecture, orange/citrus groves, lakes,
springs. A "cold front" story should still show a recognizably Florida scene (e.g. a
Florida beach or oak canopy under grey winter light) — never a European or mountainous
coastline, however moody or dramatic that might otherwise look.

Write a prompt for a generic, warm, photorealistic scene that captures the general mood
and setting of the story's category while staying geographically accurate to Florida.
For theme-parks specifically, aim for the scale and energy of an actual major park —
crowds, large thrill rides, colorful queue areas, string lights, nighttime park glow —
not a quiet resort walkway. Respond with ONLY the image prompt text, nothing else —
no preamble, no quotes.`;

  const promptUser = `Headline: ${title}\nCategory: ${category}`;

  let imagePrompt;
  try {
    imagePrompt = await askClaude(promptSystem, promptUser, 150);
  } catch (err) {
    console.error(`  [error] Could not write image prompt: ${err.message}`);
    return null;
  }

  let imageBuffer;
  try {
    imageBuffer = await generateImage(`${imagePrompt}. Photorealistic, warm natural lighting, editorial photography style.`);
  } catch (err) {
    console.error(`  [error] Image generation failed: ${err.message}`);
    return null;
  }

  return storeGeneratedImage(imageBuffer, `${slug}.png`);
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

// Turns a URL's domain into a readable source name, e.g.
// "disneyparksblog.com" -> "Disney Parks Blog", "blogmickey.com" -> "Blogmickey"
// Used for mixed/aggregated feeds (like RSS.app keyword feeds) where a single
// feed pulls from multiple real sites, so a fixed per-feed name would misattribute.
// Known domains get a clean, properly-formatted name. Anything else falls back
// to auto-deriving from the domain, which is readable but not always pretty.
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

// Screens each item before writing. Real local news feeds naturally include crime,
// death, and tragedy mixed in with lifestyle content — this keeps that off a
// lighthearted travel/lifestyle brand without needing a human to pre-curate every feed.
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
      continue;
    }

    const slug = `${slugify(article.title)}-${Date.now().toString(36)}`;

    let finalImage = realImage;
    if (finalImage) {
      console.log(`  Using real photo from source article.`);
    } else {
      console.log(`  No real photo found — generating one...`);
      finalImage = DRY_RUN ? null : await generateArticleImage({ title: article.title, category: source.category, slug });
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Title: ${article.title}`);
      console.log(`  [dry-run] Dek: ${article.dek}`);
      console.log(`  [dry-run] Image: ${realImage ? 'real photo found' : '(would generate — skipped in dry-run, costs real money)'}`);
      console.log(`  [dry-run] FB caption: ${article.fb_caption}`);
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
    await markSeen(guid);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exit(1);
});
