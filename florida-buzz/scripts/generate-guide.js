require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { askClaudeWithSearch } = require('../lib/anthropic');
const { generateArticleImage } = require('../lib/imageGen');
const { createPin } = require('../lib/pinterest');
const { notifyIndexNow } = require('../lib/indexnow');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';

// Manual topic override: set these three env vars together to force today's
// run to write on a specific subject instead of letting the weighted
// category picker + AI topic picker choose. Useful for time-sensitive or
// fact-checked topics (e.g. policy pages you want live before a promo video
// goes out) rather than waiting for the random rotation to land on them.
// Example: FORCE_CATEGORY=theme-parks FORCE_TOPIC="How DAS registration works in 2026" FORCE_TITLE="Disney World DAS: How to Register in 2026" node scripts/generate-guide.js
const FORCE_CATEGORY = process.env.FORCE_CATEGORY || null;
const FORCE_TOPIC = process.env.FORCE_TOPIC || null;
const FORCE_TITLE = process.env.FORCE_TITLE || null;

const CATEGORY_WEIGHTS = {
  'theme-parks': 45,
  beaches: 18,
  events: 12,
  wildlife: 12,
  food: 6,
  'florida-living': 4,
  cruises: 2,
  space: 1,
};

const BYLINE_WEIGHTS = {
  'The Florida Buzz Team': 67,
  'Gene Zentko': 33,
};

// Which categories to pull from if a guide's own category doesn't have
// enough other guides yet to fill out a "Related Guides" block.
const CATEGORY_AFFINITY = {
  'theme-parks': ['food', 'events', 'florida-living'],
  beaches: ['wildlife', 'florida-living', 'events'],
  events: ['theme-parks', 'florida-living', 'food'],
  wildlife: ['beaches', 'florida-living', 'events'],
  food: ['theme-parks', 'florida-living', 'events'],
  'florida-living': ['events', 'food', 'beaches'],
  cruises: ['beaches', 'food', 'events'],
  space: ['theme-parks', 'events', 'florida-living'],
};

const RELATED_GUIDES_COUNT = 3;

function pickWeightedByline() {
  const entries = Object.entries(BYLINE_WEIGHTS);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [byline, weight] of entries) {
    if (roll < weight) return byline;
    roll -= weight;
  }
  return entries[0][0];
}

function pickByline(category, topicText) {
  const isDisney = /disney/i.test(topicText || '');
  if (category === 'theme-parks' && isDisney) return 'Gene Zentko';
  if (category === 'theme-parks') return Math.random() < 0.75 ? 'Gene Zentko' : 'The Florida Buzz Team';
  return pickWeightedByline();
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function pickWeightedCategory() {
  const entries = Object.entries(CATEGORY_WEIGHTS);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [category, weight] of entries) {
    if (roll < weight) return category;
    roll -= weight;
  }
  return entries[0][0];
}

async function getExistingGuides() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('articles')
    .select('slug, title, dek, category')
    .eq('is_evergreen', true)
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error(`  [error] Could not fetch existing guides: ${error.message}`);
    return [];
  }
  return data || [];
}

// Picks up to `count` related guides for internal linking: same-category
// first (already most-recent-first from the query), then fills any
// remaining slots from affinity categories, most recent first.
function pickRelatedGuides(category, existingGuides, count = RELATED_GUIDES_COUNT) {
  const sameCategory = existingGuides.filter((g) => g.category === category);
  const picked = sameCategory.slice(0, count);

  if (picked.length < count) {
    const pickedSlugs = new Set(picked.map((g) => g.slug));
    const fallbackCategories = CATEGORY_AFFINITY[category] || [];
    for (const fallbackCategory of fallbackCategories) {
      if (picked.length >= count) break;
      const candidates = existingGuides.filter(
        (g) => g.category === fallbackCategory && !pickedSlugs.has(g.slug)
      );
      for (const candidate of candidates) {
        if (picked.length >= count) break;
        picked.push(candidate);
        pickedSlugs.add(candidate.slug);
      }
    }
  }

  return picked;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildRelatedGuidesHtml(relatedGuides) {
  if (!relatedGuides.length) return '';
  const items = relatedGuides
    .map(
      (g) => `    <li><a href="/article/${g.slug}">${escapeHtml(g.title)}</a></li>`
    )
    .join('\n');
  return `\n<div class="related-guides">\n  <h3>You Might Also Like</h3>\n  <ul>\n${items}\n  </ul>\n</div>`;
}

async function parseJsonResponse(text, label) {
  const cleaned = text.replace(/^```json\s*|```\s*$/g, '').trim();
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
    console.error(`  [debug] Raw ${label} response was not valid JSON: "${cleaned.slice(0, 200)}..."`);
    throw new Error(`Could not parse a valid ${label} from the AI response`);
  }
}

function stripCitationTags(html) {
  if (!html) return html;
  return html.replace(/<cite[^>]*>([\s\S]*?)<\/cite>/gi, '$1');
}

const AMAZON_ASSOCIATES_TAG = process.env.AMAZON_ASSOCIATES_TAG || 'floridabuzz-20';

function convertAffiliateLinks(html) {
  if (!html) return html;
  return html.replace(/href="AFFILIATE_SEARCH:([^"]+)"/gi, (match, query) => {
    const cleanQuery = query.trim();
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(cleanQuery)}&tag=${AMAZON_ASSOCIATES_TAG}`;
    return `href="${url}" target="_blank" rel="nofollow sponsored noopener"`;
  });
}

async function pickTopic(category, existingGuides) {
  const sameCategory = existingGuides.filter((g) => g.category === category).map((g) => g.title);
  const otherTitles = existingGuides.filter((g) => g.category !== category).map((g) => g.title);

  const system = `You are the topic editor for The Florida Buzz, a Florida travel and
lifestyle site. You pick ONE specific, high-search-intent evergreen guide topic for
today, within a given category. These are reference guides real travelers search for
while planning a Florida trip — practical and specific, not generic listicles.

Favor topics with genuine ongoing search demand: named systems, processes, or
comparisons people look up before a trip (how a specific park pass or access system
works, how to apply for a specific accommodation program, hotel comparisons on a named
resort property, cost-saving strategies, planning logistics). Referencing real park and
resort names (Walt Disney World, Universal Orlando Resort, etc.) in the topic is fine
and expected — this is standard travel journalism, not an endorsement or affiliation
claim.

Do not repeat or closely overlap with any topic already covered (listed below).

You may use a couple of web searches to sanity-check the topic is still current (e.g.
a program still exists, a policy hasn't obviously changed) before finalizing.

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "topic": "string, the specific angle for today's guide",
  "working_title": "string, a draft title under 70 characters"
}`;

  const user = `Category for today: ${category}

Already-covered guides in this category:
${sameCategory.length ? sameCategory.map((t) => `- ${t}`).join('\n') : '(none yet)'}

Already-covered guides in other categories (for awareness, avoid near-duplicates):
${otherTitles.length ? otherTitles.map((t) => `- ${t}`).join('\n') : '(none yet)'}`;

  const { text } = await askClaudeWithSearch(system, user, 500, 3);
  return parseJsonResponse(text, 'topic');
}

async function researchAndWriteGuide({ category, topic, workingTitle }) {
  const system = `You are a staff writer for The Florida Buzz, producing an evergreen
reference guide. Readers are actively planning a Florida trip and need CURRENT, ACCURATE
information — prices, hours, eligibility rules, and procedures change, so verify
specifics with web search rather than relying on memory. Search adaptively: start with
a few broad searches on the topic, then run targeted follow-up searches on any specific
fact (a price, a rule, a date, an official process) you're not fully certain of before
writing. Prefer official or primary sources (the park/resort's own site, official help
pages) over blogs when confirming procedural facts like eligibility or application steps.

Tone: warm, knowledgeable local-insider voice. Never breathless or clickbaity. Write
entirely original wording — never copy source text, even short phrases.

You may reference real, named parks, resorts, and their official programs or systems by
name (e.g. "Walt Disney World," "Universal Orlando Resort," a specific named pass or
access system) — this is standard factual travel journalism, not an endorsement or
affiliation claim. Do not claim any special access, insider status, or affiliation with
the parks. Where a rule or process could plausibly change over time, add a brief "check
current details before you go" caveat rather than stating it as permanently fixed.

For any specific product it would be natural to recommend (a lanyard, a portable
charger, a cooling towel, etc.), insert a link using this exact format instead of a
real product URL: <a href="AFFILIATE_SEARCH:short product search term" class="shop-link">
short descriptive text</a> — where "short product search term" is 2-4 plain words
someone would type into a shopping search bar (e.g. "polarized sunglasses" or
"water resistant phone pouch"), NOT a full sentence. Use at most 2-3 of these, only
where genuinely natural — don't force it.

CRITICAL: body_html is published directly on the site as-is. Never include 
tags, citation indices, footnote markers, or any other research/citation annotation
syntax — write plain narrative HTML only. Facts from your research should read as
confident, natural prose with no visible trace of the research process itself.

Respond ONLY with valid JSON, no markdown fences, no preamble. Schema:
{
  "title": "string, under 70 characters",
  "dek": "string, one-sentence subhead, under 140 characters",
  "body_html": "string, well-structured guide as HTML using <p>, <h3>, and <ul>/<li> as needed, 500-900 words, ends with a brief practical tip or takeaway",
  "fb_caption": "string, Facebook post: 1-2 punchy sentences plus a relevant emoji, ends with 'Full guide \\u2193' — no hashtags",
  "pin_title": "string, under 100 characters, descriptive and keyword-rich (Pinterest is a search engine, not a feed)",
  "pin_description": "string, 1-2 sentences, under 500 characters, naturally including relevant search terms a Florida traveler might type"
}`;

  const user = `Category: ${category}
Topic: ${topic}
Working title idea: ${workingTitle}`;

  const { text, searchesUsed } = await askClaudeWithSearch(system, user, 6000, 12);
  console.log(`  Used ${searchesUsed} web search${searchesUsed === 1 ? '' : 'es'} while researching.`);
  const guide = await parseJsonResponse(text, 'guide');
  guide.body_html = stripCitationTags(guide.body_html);
  guide.body_html = convertAffiliateLinks(guide.body_html);
  return guide;
}

async function postToFacebook({ fb_caption, slug }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] Would post to Facebook: "${fb_caption}"`);
    return true;
  }
  if (!process.env.FB_PAGE_ID || !process.env.FB_PAGE_ACCESS_TOKEN) {
    console.log('  [skip] FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set — skipping Facebook post.');
    return false;
  }

  const articleUrl = `${SITE_URL}/article/${slug}`;

  const res = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: fb_caption,
      link: articleUrl,
      access_token: process.env.FB_PAGE_ACCESS_TOKEN,
    }),
  });

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
    console.log('  [skip] No image available for this guide — Pinterest requires one, skipping.');
    return false;
  }

  const articleUrl = `${SITE_URL}/article/${slug}`;

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

async function run() {
  console.log(`=== Daily evergreen guide generation — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be saved or posted.\n');

  const category = FORCE_CATEGORY || pickWeightedCategory();
  console.log(FORCE_CATEGORY ? `Category forced for today: ${category}` : `Category for today: ${category}`);

  const existingGuides = await getExistingGuides();
  console.log(`Found ${existingGuides.length} existing guide(s) on record.`);

  console.log("Choosing today's topic...");
  let topicPick;
  if (FORCE_TOPIC && FORCE_TITLE) {
    console.log('  Topic forced via FORCE_TOPIC/FORCE_TITLE — skipping AI topic selection.');
    topicPick = { topic: FORCE_TOPIC, working_title: FORCE_TITLE };
  } else {
    try {
      topicPick = await pickTopic(category, existingGuides);
    } catch (err) {
      console.error(`[error] Topic selection failed: ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`  Topic: ${topicPick.topic}`);
  console.log(`  Working title: ${topicPick.working_title}`);

  const byline = pickByline(category, `${topicPick.topic} ${topicPick.working_title}`);
  console.log(`Byline for today: ${byline}`);

  console.log('Researching and writing the guide (this can take a minute)...');
  let guide;
  try {
    guide = await researchAndWriteGuide({
      category,
      topic: topicPick.topic,
      workingTitle: topicPick.working_title,
    });
  } catch (err) {
    console.error(`[error] Guide writing failed: ${err.message}`);
    process.exit(1);
  }

  const relatedGuides = pickRelatedGuides(category, existingGuides);
  if (relatedGuides.length) {
    console.log(`  Linking to ${relatedGuides.length} related guide(s): ${relatedGuides.map((g) => g.slug).join(', ')}`);
    guide.body_html = `${guide.body_html}${buildRelatedGuidesHtml(relatedGuides)}`;
  } else {
    console.log('  No related guides yet to link to (this is expected early on).');
  }

  const slug = `${slugify(guide.title)}-${Date.now().toString(36)}`;

  console.log('Generating image...');
  const imageUrl = DRY_RUN ? null : await generateArticleImage({ title: guide.title, category, slug });

  if (DRY_RUN) {
    console.log(`\n[dry-run] Title: ${guide.title}`);
    console.log(`[dry-run] Byline: ${byline}`);
    console.log(`[dry-run] Dek: ${guide.dek}`);
    console.log(`[dry-run] Body HTML:\n${guide.body_html}`);
    console.log(`[dry-run] FB caption: ${guide.fb_caption}`);
    console.log(`[dry-run] Pin title: ${guide.pin_title}`);
    console.log(`[dry-run] Pin description: ${guide.pin_description}`);
    console.log('\n=== Dry run complete — nothing saved ===');
    return;
  }

  if (!supabase) {
    console.error('[error] Supabase not configured — cannot save guide.');
    process.exit(1);
  }

  const { error } = await supabase.from('articles').insert({
    slug,
    title: guide.title,
    dek: guide.dek,
    body_html: guide.body_html,
    category,
    source_name: byline,
    source_url: SITE_URL,
    image_url: imageUrl,
    fb_caption: guide.fb_caption,
    is_evergreen: true,
  });

  if (error) {
    console.error(`[error] Could not save guide: ${error.message}`);
    process.exit(1);
  }
  console.log(`Saved guide: /article/${slug}`);
  await notifyIndexNow(`${SITE_URL}/article/${slug}`);

  await postToFacebook({ fb_caption: guide.fb_caption, slug });
  await postToPinterest({
    pin_title: guide.pin_title,
    pin_description: guide.pin_description,
    slug,
    imageUrl,
  });

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in guide generation run:', err);
  process.exit(1);
});
