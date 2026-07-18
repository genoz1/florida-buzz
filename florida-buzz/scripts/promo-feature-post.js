require('dotenv').config();
const { supabase, storeGeneratedImage } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateImage } = require('../lib/openai');
const { createPin } = require('../lib/pinterest');
const { createPost: createInstagramPost } = require('../lib/instagram');
const { createPost: createThreadsPost } = require('../lib/threads');
const { postToFacebookPage } = require('../lib/facebook');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';

// Promotes the site's own tools/features (currently: live wait times, dining
// directories) rather than a specific article — a distinct content type from
// news, guides, and engagement posts. Run with:
//   TOPIC=wait-times node scripts/promo-feature-post.js
//   TOPIC=dining node scripts/promo-feature-post.js
// Designed to run once daily per topic (see server.js) — different caption
// every time, but reuses one cached image per topic rather than generating
// a new one on every post.
const TOPICS = {
  'wait-times': {
    path: '/wait-times',
    imagePrompt: `A generic, unbranded still-life photo relevant to checking live theme
park wait times — for example a phone showing a simple, blank wait-time-style list UI
(no real app logos, no real park names) next to a park map (blank/generic, no real
logos) and sunglasses, on a wooden table or beach towel. Bright, warm, editorial
travel-blog photography style. No real logos, no readable brand names, no copyrighted
characters, no recognizable real park architecture.`,
  },
  dining: {
    path: '/dining',
    imagePrompt: `A generic, unbranded still-life photo relevant to restaurant planning —
for example a table setting with a blank/generic reservation card, a folded napkin, and
simple cutlery, on a wooden table. Bright, warm, editorial food-blog photography style.
No real logos, no readable brand names, no copyrighted characters.`,
  },
};

async function getOrCreateImage(topic) {
  if (supabase) {
    const { data } = await supabase
      .from('feature_promo_images')
      .select('image_url')
      .eq('topic', topic)
      .maybeSingle();
    if (data?.image_url) return data.image_url;
  }

  console.log(`  No cached image yet for "${topic}" — generating one (this only happens once per topic)...`);
  const imageBuffer = await generateImage(`${TOPICS[topic].imagePrompt} Photorealistic, warm natural lighting.`);
  const imageUrl = await storeGeneratedImage(imageBuffer, `promo-${topic}.png`);

  if (imageUrl && supabase) {
    await supabase.from('feature_promo_images').upsert({ topic, image_url: imageUrl });
  }
  return imageUrl;
}

async function getRecentCaptions(topic, limit = 10) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('feature_promo_posts')
    .select('message')
    .eq('topic', topic)
    .order('posted_at', { ascending: false })
    .limit(limit);
  return (data || []).map((row) => row.message);
}

async function getDiningContext() {
  if (!supabase) return 'Magic Kingdom';
  const { data } = await supabase.from('restaurants').select('park');
  const parks = [...new Set((data || []).map((r) => r.park))];
  const labels = {
    'magic-kingdom': 'Magic Kingdom',
    epcot: 'EPCOT',
    'hollywood-studios': "Hollywood Studios",
    'animal-kingdom': 'Animal Kingdom',
    resorts: 'Disney Resort hotels',
  };
  return parks.map((p) => labels[p] || p).join(', ') || 'Magic Kingdom';
}

async function generateCaption(topic, recentCaptions) {
  const isDining = topic === 'dining';
  const diningContext = isDining ? await getDiningContext() : null;

  const system = `You write short, punchy promotional social posts for The Florida Buzz,
a Florida travel site, promoting one of the site's own free tools (not a news article).

${isDining
    ? `The tool is a filterable dining directory — currently covering: ${diningContext}. It lets people filter by quick service vs. table service, whether a reservation is required, and character dining.`
    : `The tool is a live wait-times tracker covering all 7 major Disney World and Universal Orlando parks, updated every few minutes.`}

Write something genuinely different from these recent posts about the same tool — vary
the angle, hook, and wording each time, don't just reword the same sentence:
${recentCaptions.length ? recentCaptions.map((c) => `- ${c}`).join('\n') : '(no recent posts yet)'}

Keep it under 300 characters, warm and useful in tone, not salesy. No hashtags.

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "message": "the core promotional message, without any link or CTA phrase — just the hook/value, 1-2 sentences",
  "pin_title": "under 100 characters, descriptive and keyword-rich for Pinterest search",
  "pin_description": "1-2 sentences, under 500 characters, naturally keyword-rich"
}`;

  const text = await askClaude(system, 'Generate today\'s promotional post.', 500);
  const cleaned = text.replace(/^```json\s*|```\s*$/g, '').trim();
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
    throw new Error(`Could not parse a valid caption from the AI response: "${cleaned.slice(0, 200)}..."`);
  }
}

async function run() {
  const topic = process.env.TOPIC;
  if (!topic || !TOPICS[topic]) {
    console.error(`[error] Set TOPIC to one of: ${Object.keys(TOPICS).join(', ')}`);
    process.exit(1);
  }

  console.log(`=== Feature promo post — ${topic} — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be posted or saved.\n');

  const pageUrl = `${SITE_URL}${TOPICS[topic].path}`;

  const imageUrl = await getOrCreateImage(topic);
  if (!imageUrl) {
    console.error('[error] Could not get or generate a promotional image — aborting.');
    process.exit(1);
  }

  const recentCaptions = await getRecentCaptions(topic);
  let caption;
  try {
    caption = await generateCaption(topic, recentCaptions);
  } catch (err) {
    console.error(`[error] Caption generation failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`Message: ${caption.message}`);

  const facebookCaption = `${caption.message} ${pageUrl}`;
  const instagramCaption = `${caption.message} Link in bio 🔗`;
  const threadsCaption = `${caption.message} ${pageUrl}`;

  const results = {};

  results.facebook = await postToFacebookPage({ message: caption.message, link: pageUrl, imageUrl, dryRun: DRY_RUN });

  if (DRY_RUN) {
    console.log(`[dry-run] Would post to Instagram: "${instagramCaption}"`);
    console.log(`[dry-run] Would post to Threads: "${threadsCaption}"`);
    console.log(`[dry-run] Would create Pin: "${caption.pin_title}"`);
    results.instagram = results.threads = results.pinterest = true;
  } else {
    try {
      await createInstagramPost({ imageUrl, caption: instagramCaption });
      results.instagram = true;
    } catch (err) {
      console.error(`  [error] Instagram post failed: ${err.message}`);
      results.instagram = false;
    }

    try {
      await createThreadsPost({ text: threadsCaption, imageUrl });
      results.threads = true;
    } catch (err) {
      console.error(`  [error] Threads post failed: ${err.message}`);
      results.threads = false;
    }

    try {
      await createPin({ imageUrl, title: caption.pin_title, description: caption.pin_description, link: pageUrl });
      results.pinterest = true;
    } catch (err) {
      console.error(`  [error] Pinterest post failed: ${err.message}`);
      results.pinterest = false;
    }
  }

  console.log(`Results — Facebook: ${results.facebook}, Instagram: ${results.instagram}, Threads: ${results.threads}, Pinterest: ${results.pinterest}`);

  if (!DRY_RUN && supabase) {
    await supabase.from('feature_promo_posts').insert({ topic, message: caption.message });
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in promo-feature-post run:', err);
  process.exit(1);
});
