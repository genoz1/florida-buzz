require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateArticleImage } = require('../lib/imageGen');
const { postToFacebookPage } = require('../lib/facebook');
const { notifyIndexNow } = require('../lib/indexnow');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';
// Spacing between each city's post, same reasoning as the article automation —
// avoids 4 posts landing in the feed at the exact same minute.
const ROUNDUP_POST_DELAY_MINUTES = parseInt(process.env.ROUNDUP_POST_DELAY_MINUTES, 10) || 10;

const CITY_LABELS = {
  jacksonville: 'Jacksonville',
  tampa: 'Tampa Bay',
  orlando: 'Orlando',
  miami: 'Miami',
};
const CITIES = Object.keys(CITY_LABELS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

// Monday = look back further and frame as "this week." Friday = tighter window,
// framed as "this weekend." Either way, this only ever references articles the
// site has ALREADY researched and published via the normal automation — no new
// research happens here, just a roundup/repackaging of real, existing content.
function getModeForToday() {
  const day = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long' });
  if (day === 'Monday') return { mode: 'week', lookbackDays: 10 };
  if (day === 'Friday') return { mode: 'weekend', lookbackDays: 7 };
  return null;
}

// Computes the actual date range for the title (e.g. "July 6-12" or "July 10-12")
// in code rather than trusting the AI to do date math — guarantees it's always
// correct, and gives every week's article a genuinely unique, search-friendly
// title instead of the same generic phrase repeating indefinitely.
function getDateRangeLabel(mode) {
  const fmt = (d) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric' });
  const now = new Date();
  const easternNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  let start, end;
  if (mode === 'week') {
    start = easternNow;
    end = new Date(easternNow);
    end.setDate(end.getDate() + 6); // Monday through Sunday
  } else {
    start = easternNow;
    end = new Date(easternNow);
    end.setDate(end.getDate() + 2); // Friday through Sunday
  }

  const startLabel = fmt(start);
  const endLabel = fmt(end);
  // Avoid repeating the month twice if the range stays within one month (e.g. "July 6-12" not "July 6-July 12")
  const startMonth = start.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long' });
  const endMonth = end.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long' });
  if (startMonth === endMonth) {
    return `${startLabel}-${end.getDate()}`;
  }
  return `${startLabel} - ${endLabel}`;
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

async function getRecentCityArticles(city, lookbackDays) {
  if (!supabase) return [];
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('articles')
    .select('title, dek, slug, published_at')
    .eq('city', city)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(8);

  if (error) {
    console.error(`  [error] Could not fetch articles for ${city}: ${error.message}`);
    return [];
  }
  return data || [];
}

async function composeRoundup({ cityLabel, mode, articles }) {
  const timeframe = mode === 'weekend' ? 'this weekend' : 'this week';
  const system = `You write a roundup article for The Florida Buzz, rounding up real local
events already covered on the site. You ONLY reference the specific articles provided below
— never invent an event, date, or detail not present in them. Do not invent facts beyond
what's in each article's title/dek.

IMPORTANT: never include a specific date or date range (like "July 10-12") anywhere in the
title or meta_title, even if one of the source articles below has a date in its own title.
The exact current date range gets added automatically after you write the title — if you
also include one, it will appear twice. Just write "This Week"/"This Weekend" and the city
name, nothing more specific than that.

Respond ONLY with valid JSON, no markdown fences, no preamble. Schema:
{
  "title": "string, under 70 characters, e.g. 'What to Do ${timeframe === 'this weekend' ? 'This Weekend' : 'This Week'} in ${cityLabel}' — NO dates",
  "meta_title": "string, under 60 characters, search-friendly version of the title including the timeframe and city — NO dates",
  "dek": "string, one-sentence subhead, under 140 characters",
  "body_html": "string, a short warm intro paragraph as a <p> tag, then a <ul> with one <li> per article — each li should briefly describe the event in original wording (not copied from the dek) and include a real <a href> link to that article's URL (provided below) with descriptive link text — end with a brief closing <p> tag",
  "fb_caption": "string, Facebook post: 2-3 warm, inviting sentences teasing a couple of these events for ${timeframe} in ${cityLabel}, no hashtags, ends with a relevant emoji"
}`;

  const user = articles
    .map((a, i) => `${i + 1}. ${a.title} — ${a.dek} (${SITE_URL}/article/${a.slug})`)
    .join('\n');

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
        // fall through
      }
    }
    throw new Error('Could not parse a valid roundup article from the AI response');
  }
}

async function run() {
  console.log(`=== City roundup run — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be saved or posted.\n');

  const today = getModeForToday();
  if (!today) {
    console.log('Not Monday or Friday — nothing to do today.');
    return;
  }

  console.log(`Mode: "${today.mode}" roundups (looking back ${today.lookbackDays} days)\n`);

  let postCount = 0;

  for (const city of CITIES) {
    console.log(`Checking ${CITY_LABELS[city]}...`);
    const articles = await getRecentCityArticles(city, today.lookbackDays);

    if (articles.length < 2) {
      console.log(`  [skip] Only ${articles.length} recent article(s) for this city — not enough for a real roundup.`);
      continue;
    }

    console.log(`  Found ${articles.length} recent articles. Composing roundup...`);
    let roundup;
    try {
      roundup = await composeRoundup({ cityLabel: CITY_LABELS[city], mode: today.mode, articles });
    } catch (err) {
      console.error(`  [error] Could not compose roundup: ${err.message}`);
      continue;
    }

    // Defensive strip: even with the prompt instruction above, the model can
    // occasionally still echo a date range it saw in one of the source
    // articles' own titles (e.g. "Top 5 things to do in Jacksonville July
    // 10-12"). Remove any trailing "(Month Day-Day)"-style parenthetical
    // before appending the correct, freshly-computed one below, so we never
    // end up with two date ranges stacked in the same title.
    const datePattern = /\s*\([A-Z][a-z]+\.?\s+\d{1,2}(-\d{1,2})?\)\s*$/;
    roundup.title = roundup.title.replace(datePattern, '').trim();
    roundup.meta_title = roundup.meta_title.replace(datePattern, '').trim();

    const dateRangeLabel = getDateRangeLabel(today.mode);
    roundup.title = `${roundup.title} (${dateRangeLabel})`;
    roundup.meta_title = `${roundup.meta_title} (${dateRangeLabel})`;

    console.log(`  Title: ${roundup.title}`);

    const slug = await generateUniqueSlug(roundup.meta_title || roundup.title);

    if (DRY_RUN) {
      console.log(`  [dry-run] Meta title: ${roundup.meta_title}`);
      console.log(`  [dry-run] Dek: ${roundup.dek}`);
      console.log(`  [dry-run] Body HTML:\n${roundup.body_html}`);
      console.log(`  [dry-run] FB caption: ${roundup.fb_caption}`);
      continue;
    }

    console.log('  Generating image...');
    const imageUrl = await generateArticleImage({ title: roundup.title, category: 'events', slug });

    if (supabase) {
      const { error } = await supabase.from('articles').insert({
        slug,
        title: roundup.title,
        meta_title: roundup.meta_title,
        dek: roundup.dek,
        body_html: roundup.body_html,
        category: 'events',
        city,
        source_name: 'The Florida Buzz staff',
        source_url: SITE_URL,
        image_url: imageUrl,
        fb_caption: roundup.fb_caption,
      });
      if (error) {
        console.error(`  [error] Could not save roundup article: ${error.message}`);
        continue;
      }
      console.log(`  Saved article: /article/${slug}`);
      await notifyIndexNow(`${SITE_URL}/article/${slug}`);
    }

    if (postCount > 0) {
      console.log(`  Waiting ${ROUNDUP_POST_DELAY_MINUTES} minute(s) before the next city's post...`);
      await sleep(ROUNDUP_POST_DELAY_MINUTES * 60 * 1000);
    }

    const ok = await postToFacebookPage({
      message: roundup.fb_caption,
      link: `${SITE_URL}/article/${slug}`,
      dryRun: DRY_RUN,
    });
    console.log(ok ? '  Posted successfully.' : '  Post failed or was skipped — see above.');
    postCount += 1;
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in city roundup run:', err);
  process.exit(1);
});
