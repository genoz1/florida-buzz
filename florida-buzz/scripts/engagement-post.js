require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { postToFacebookPage } = require('../lib/facebook');

const DRY_RUN = process.env.DRY_RUN === 'true';

// V1 of Florida Buzz's "Engagement Posts" — lightweight, comment-driving
// posts distinct from news articles/guides. Native Facebook/Instagram polls
// aren't creatable through the standard posting API, so this mimics a poll
// with a "vote in the comments" style this-or-that post instead. Starting
// with ONE post per day and ONE format (this-or-that) deliberately — more
// formats (trivia, emoji reactions, guess-the-location) can be added as
// their own functions later once this format's performance is known.

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
readers to vote in the comments between two Florida-related options — beaches,
theme parks, food, wildlife, road trips, etc. They should feel light and
inviting, never like an ad or a news item.

Format rules:
- Two options only, each with one relevant emoji
- End with a short line inviting comments, like "Comment your pick!" or
  "Drop a 🏖️ or a 🎢 below!"
- No links, no hashtags, no mention of TheFloridaBuzz.com — this is a pure
  engagement post, not a promotional one
- Keep it under 300 characters total
- Do not repeat or closely overlap with any topic already used recently (listed below)

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "topic": "short internal label for this topic, e.g. 'clearwater-vs-siesta-key'",
  "message": "the full post text, ready to publish as-is"
}`;

  const user = `Recently used topics (avoid repeating or closely overlapping with these):
${recentTopics.length ? recentTopics.map((t) => `- ${t}`).join('\n') : '(none yet)'}`;

  const text = await askClaude(system, user, 400);
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
    throw new Error(`Could not parse engagement post JSON: "${cleaned.slice(0, 200)}..."`);
  }
}

async function run() {
  console.log(`=== Engagement post — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be posted or saved.\n');

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

  const ok = await postToFacebookPage({ message: post.message, link: null, dryRun: DRY_RUN });
  console.log(ok ? '  Posted successfully.' : '  Post failed or was skipped — see above.');

  if (!DRY_RUN && ok && supabase) {
    const { error } = await supabase.from('engagement_posts').insert({
      topic: post.topic,
      message: post.message,
    });
    if (error) console.error(`  [error] Could not save engagement post record: ${error.message}`);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in engagement-post run:', err);
  process.exit(1);
});
