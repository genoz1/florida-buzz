// Shared helper for logging every real (non-dry-run) post attempt to
// Supabase, so /admin/post-report can show per-platform counts and catch
// silent failures. Called internally by each platform's posting library
// (facebook.js, pinterest.js, instagram.js, threads.js) — nothing in the
// individual scripts (automate.js, generate-guide.js, promo-post.js,
// city-roundup.js, engagement-post.js) needs to change to be tracked.
const { supabase } = require('./supabase');

async function logPost({ platform, status, detail }) {
  if (!supabase) return;
  try {
    await supabase.from('post_log').insert({
      platform,
      status,
      detail: detail ? String(detail).slice(0, 500) : null,
    });
  } catch (err) {
    // Logging failures should never break the actual posting flow.
    console.error(`  [warn] Could not write to post_log: ${err.message}`);
  }
}

module.exports = { logPost };
