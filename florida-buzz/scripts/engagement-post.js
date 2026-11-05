require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { generateStructuredText } = require('../lib/aiText');
const { engagementPost: engagementPostSchema } = require('../lib/aiSchemas');
const { validateEngagementPost } = require('../lib/contentValidation');
const { postToFacebookPage } = require('../lib/facebook');
const { isNonArticleFacebookAllowed } = require('../lib/facebookDistribution');

const DRY_RUN = process.env.DRY_RUN === 'true';

// V1 of Florida Buzz's "Engagement Posts" — lightweight, engagement-driving
// posts distinct from news articles/guides. Native Facebook/Instagram polls
// aren't creatable through the standard posting API, so this mimics a poll
// with a "react to vote" this-or-that post instead — reacting is much
// lower-friction than commenting, which matters a lot for a smaller,
// newer account still building an audience. Starting with ONE post per day
// and ONE format (this-or-that) deliberately — more formats (trivia, guess-
// the-location) can be added as their own functions later once this
// format's performance is known.

async function getRecentTopics(limit = 15) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('engagement_posts')
    .select('topic')
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`  [error] Could not fetch recent engagement topics: ${error.message}`);
    return [];
  }
  return (data || []).map((row) => row.topic);
}

async function generateThisOrThat(recentTopics) {
  const system = `You write short, fun "this or that" engagement posts for The
Florida Buzz, a Florida travel and lifestyle Facebook page. These posts ask
readers to vote between two Florida-related options — beaches, theme parks,
food, wildlife, road trips, etc. — using a REACTION, not a comment. Reacting
is much lower-friction than typing a comment, especially for a smaller,
newer account, so voting must always be framed as a tap/react action.

Format rules:
- Open with a strong first-line hook that names the real Florida choice in
  under ~80 characters (specific places/experiences, not vague "beach or
  park?" filler). The hook should make someone stop scrolling before they
  see the reaction instructions.
- Two options only, each paired with a DIFFERENT native Facebook/Instagram
  reaction emoji as the vote — e.g. "❤️ for the beach, 👍 for the theme
  park" or "😍 for Disney, 😮 for Universal". Never ask people to comment
  their pick; always ask them to react with one of the two specified emojis.
- End with a short reaction CTA like "React with your pick!" or "Tap ❤️ or
  👍 below!" — never engagement-bait ("comment YES", "tag a friend", "share
  if you agree", giveaways, or "algorithm" language).
- No hashtags. Keep the reaction CTA primary; do not bury it under promo copy.
- Keep it under 280 characters before the site line we append after generation.
- Do not repeat or closely overlap with any topic already used recently (listed below)

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "topic": "short internal label for this topic, e.g. 'clearwater-vs-siesta-key'",
  "message": "the full post text, ready to publish as-is"
}`;

  const user = `Recently used topics (avoid repeating or closely overlapping with these):
${recentTopics.length ? recentTopics.map((t) => `- ${t}`).join('\n') : '(none yet)'}`;

  return validateEngagementPost(await generateStructuredText(system, user, engagementPostSchema, 400));
}

async function run() {
  console.log(`=== Engagement post — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be posted or saved.\n');

  const feedGate = isNonArticleFacebookAllowed();
  if (!feedGate.ok) {
    console.log(`  [skip] Facebook engagement: ${feedGate.reason} — ${feedGate.detail}`);
    console.log('\n=== Run complete ===');
    return;
  }

  const recentTopics = await getRecentTopics();
  console.log(`Avoiding ${recentTopics.length} recently used topic(s).`);

  let post;
  try {
    post = await generateThisOrThat(recentTopics);
  } catch (err) {
    console.error(`[error] Could not generate engagement post: ${err.message}`);
    process.exit(1);
  }

  console.log(`Topic: ${post.topic}`);
  console.log(`Message:\n${post.message}`);

  const siteUrl = (process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
  // Every social post needs a path back to the site. Keep the reaction CTA
  // first; append the homepage URL in the caption (first_comment is broken
  // without comment permission).
  const messageWithLink = post.message.includes(siteUrl)
    ? post.message
    : `${post.message}\n\nMore Florida news: ${siteUrl}`;
  const ok = await postToFacebookPage({
    message: messageWithLink,
    link: siteUrl,
    dryRun: DRY_RUN,
    linkPlacement: 'caption',
    linkCommentKind: 'article',
  });
  console.log(ok ? '  Posted successfully.' : '  Post failed or was skipped — see above.');

  if (!DRY_RUN && ok && supabase) {
    const { error } = await supabase.from('engagement_posts').insert({
      topic: post.topic,
      message: messageWithLink,
    });
    if (error) console.error(`  [error] Could not save engagement post record: ${error.message}`);
  }

  console.log('\n=== Run complete ===');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal error in engagement-post run:', err);
    process.exit(1);
  });
}

module.exports = { run, generateThisOrThat };
