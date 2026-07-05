require('dotenv').config();
const Parser = require('rss-parser');
const { supabase, storeGeneratedImage, storeImageFromUrl } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateArticleImage } = require('../lib/imageGen');
const { createPin } = require('../lib/pinterest');
const { postToFacebookPage } = require('../lib/facebook');
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
// How many of a source's most recent items to check per run, not just the
// single newest one. Raising this catches posts you'd otherwise silently miss
// from fast-publishing sources, at the cost of more AI calls per run (each
// checked item costs a safety-check call, and if it passes, a writing call
// and possibly an image-generation call). Tune based on cost comfort.
const MAX_ITEMS_PER_SOURCE = parseInt(process.env.MAX_ITEMS_PER_SOURCE, 10) || 3;
// Minutes to wait between Facebook posts within a single run, so a burst of
// several new articles doesn't all hit the Page in the same minute. Articles
// still save to the site immediately either way — only the Facebook posting
// is spread out. Keep this modest: with up to 14 sources x 3 items, a run
// could have a dozen+ posts, and a long delay could push a run's total time
// close to the ~4-5 hour gap between scheduled runs.
const FB_POST_DELAY_MINUTES = parseInt(process.env.FB_POST_DELAY_MINUTES, 10) || 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function generateUniqueSlug(baseTitle) {
  const base = slugify(baseTitle);
  if (!supabase) return `${base}-${Date.now().toString(36)}`;

  let candidate = base;
  let suffix = 2;
  while (true) {
    const { data } = await supabase.from('articles').select('slug').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
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
Answer NO for: content that isn't actually about Florida — e.g. a Legoland,
Universal, or other brand's location outside Florida (California, New York,
Michigan, other countries, etc.), even if the brand also has a Florida
location. Only cover the Florida version/location of a topic.
Answer YES for: theme park news, travel deals, wildlife sightings/conservation,
weather, festivals, food, beaches, cruises, space launches — the normal, upbeat
local news and lifestyle content this site covers, specifically about Florida.
When genuinely unsure, answer NO — it's better to skip a borderline story than
publish something insensitive or off-topic.`;

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
  "meta_title": "string, under 60 characters, written the way a person would phrase a Google search for this topic — lead with the specific place, attraction, or subject name, plus what changed (e.g. 'Magic Kingdom Lightning Lane Prices July 2026' not a clever headline). This is for the browser tab and Google search result, not the on-page headline — it should read naturally, not keyword-stuffed.",
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
  const articleUrl = `${process.env.SITE_URL}/article/${slug}`;
  return postToFacebookPage({ message: fb_caption, link: articleUrl, dryRun: DRY_RUN });
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
  if (!DRY_RUN) console.log(`Facebook posts will be spaced ${FB_POST_DELAY_MINUTES} minute(s) apart within this run.\n`);

  let fbPostCount = 0;

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

    const itemsToCheck = feed.items.slice(0, MAX_ITEMS_PER_SOURCE);
    for (const item of itemsToCheck) {
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
        await markSeen(guid);
        continue;
      }

      const slug = await generateUniqueSlug(article.meta_title || article.title);

      let finalImage;
      if (source.preferAI) {
        console.log(`  This source is set to always use AI images — generating...`);
        finalImage = DRY_RUN ? null : await generateArticleImage({ title: article.title, category: source.category, slug });
      } else if (realImage) {
        if (DRY_RUN) {
          console.log(`  [dry-run] Would download and permanently store real photo from source.`);
          finalImage = null;
        } else {
          console.log(`  Found real photo — downloading and storing it permanently (not hotlinking)...`);
          const storedUrl = await storeImageFromUrl(realImage, `${slug}.jpg`);
          if (storedUrl) {
            console.log(`  Stored real photo permanently.`);
            finalImage = storedUrl;
          } else {
            console.log(`  Could not download/store the real photo — generating an AI image instead so this article isn't left depending on the source's server.`);
            finalImage = await generateArticleImage({ title: article.title, category: source.category, slug });
          }
        }
      } else {
        console.log(`  No real photo found — generating one...`);
        finalImage = DRY_RUN ? null : await generateArticleImage({ title: article.title, category: source.category, slug });
      }

      if (DRY_RUN) {
        console.log(`  [dry-run] Title: ${article.title}`);
        console.log(`  [dry-run] Meta title (for Google): ${article.meta_title}`);
        console.log(`  [dry-run] Dek: ${article.dek}`);
        console.log(`  [dry-run] Image: ${source.preferAI ? '(would generate — preferAI is set)' : realImage ? '(would download and permanently store the real photo)' : '(would generate — no real photo found)'}`);
        console.log(`  [dry-run] FB caption: ${article.fb_caption}`);
        console.log(`  [dry-run] Pin title: ${article.pin_title}`);
        console.log(`  [dry-run] Pin description: ${article.pin_description}`);
      } else if (supabase) {
        const { error } = await supabase.from('articles').insert({
          slug,
          title: article.title,
          meta_title: article.meta_title,
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

      if (!DRY_RUN && fbPostCount > 0) {
        console.log(`  Waiting ${FB_POST_DELAY_MINUTES} minute(s) before the next Facebook post...`);
        await sleep(FB_POST_DELAY_MINUTES * 60 * 1000);
      }
      await postToFacebook({ title: article.title, fb_caption: article.fb_caption, slug });
      fbPostCount += 1;
      await postToPinterest({ pin_title: article.pin_title, pin_description: article.pin_description, slug, imageUrl: finalImage });
      await markSeen(guid);
    }
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in automation run:', err);
  process.exit(1);
});
