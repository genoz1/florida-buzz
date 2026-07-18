// Shared helper for logging every 404 hit — used by both routes/main.js
// (for known routes with an invalid specific value, like a bad article
// slug) and server.js (for URLs that don't match any route at all).
const { supabase } = require('./supabase');

async function logNotFound(path, referrer) {
  if (!supabase) return;
  try {
    await supabase.from('not_found_log').insert({
      path: (path || '').slice(0, 500),
      referrer: referrer ? String(referrer).slice(0, 500) : null,
    });
  } catch (err) {
    // Logging failures should never break the actual 404 response.
    console.error(`  [warn] Could not write to not_found_log: ${err.message}`);
  }
}

module.exports = { logNotFound };
