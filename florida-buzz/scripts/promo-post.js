require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { postToFacebookPage } = require('../lib/facebook');

const DRY_RUN = process.env.DRY_RUN === 'true';
const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';

// A few variations per type so consecutive posts of the same type don't
// look identical. Picked randomly at post time.

const BRAND_MESSAGES = [
  `🌴 New here? Florida Buzz posts fresh Florida news every day — Disney, Universal, beaches, wildlife, and more. Give us a follow so you don't miss the next one! ${SITE_URL}`,
  `☀️ Florida moves fast — new theme park news, beach finds, and local happenings, every single day. Follow along: ${SITE_URL}`,
  `🐊 From Magic Kingdom updates to hidden beach towns, Florida Buzz covers it daily. Bookmark us: ${SITE_URL}`,
];

const NEWSLETTER_MESSAGES = [
  `📬 Prefer your Florida news in your inbox? Sign up for our free daily roundup — one email, all the best stories: ${SITE_URL}/#newsletter`,
  `✉️ Get the day's best Florida stories delivered straight to you. Free daily email, sign up here: ${SITE_URL}/#newsletter`,
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getRandomGuide() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('articles').select('*').eq('is_evergreen', true);
  if (error || !data || !data.length) return null;
  return pickRandom(data);
}

async function buildPost(type) {
  if (type === 'brand') {
    return { message: pickRandom(BRAND_MESSAGES), link: null };
  }

  if (type === 'newsletter') {
    return { message: pickRandom(NEWSLETTER_MESSAGES), link: null };
  }

  if (type === 'guide') {
    const guide = await getRandomGuide();
    if (!guide) {
      console.log('  [skip] No guides available yet — falling back to a brand post.');
      return { message: pickRandom(BRAND_MESSAGES), link: null };
    }
    const guideUrl = `${SITE_URL}/article/${guide.slug}`;
    return {
      message: `📖 Guide: ${guide.title}\n${guide.dek}\nRead the full guide: ${guideUrl}`,
      link: null, // link is already inline in the message text above
    };
  }

  return null;
}

async function run() {
  console.log(`=== Florida Buzz promo post — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be posted.\n');

  // Rotates through brand / newsletter / guide roughly evenly across runs,
  // without needing any stored state — derived purely from the current time.
  const ROTATION = ['brand', 'newsletter', 'guide'];
  const slot = Math.floor(Date.now() / (12 * 60 * 60 * 1000)) % ROTATION.length;
  const type = ROTATION[slot];

  console.log(`Post type this run: ${type}`);

  const post = await buildPost(type);
  if (!post) {
    console.error('  [error] Could not build a post for this rotation slot.');
    return;
  }

  const ok = await postToFacebookPage({ message: post.message, link: post.link, dryRun: DRY_RUN });
  console.log(ok ? '  Posted successfully.' : '  Post failed or was skipped — see above.');

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in promo-post run:', err);
  process.exit(1);
});
