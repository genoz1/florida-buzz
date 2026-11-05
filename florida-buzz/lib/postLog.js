// Shared helper for logging every real (non-dry-run) post attempt to
// Supabase, so /admin/post-report and ops health checks can catch silent
// failures. Called internally by each platform's posting library.
const { supabase } = require('./supabase');

/**
 * @param {{ platform: string, status: string, detail?: string|null, link?: string|null|undefined }} args
 * When `link` is provided:
 * - non-empty string → append `[link:URL]` so health checks can verify site traffic paths
 * - null → append `[link:MISSING]` (post succeeded without a destination URL)
 * When `link` is omitted, no marker is added (legacy callers).
 */
async function logPost({ platform, status, detail, link }) {
  if (!supabase) return;
  try {
    let text = detail ? String(detail).slice(0, 420) : '';
    if (link !== undefined) {
      const marker = link ? `[link:${String(link).slice(0, 220)}]` : '[link:MISSING]';
      text = text ? `${text} ${marker}` : marker;
    }
    await supabase.from('post_log').insert({
      platform,
      status,
      detail: text || null,
    });
  } catch (err) {
    // Logging failures should never break the actual posting flow.
    console.error(`  [warn] Could not write to post_log: ${err.message}`);
  }
}

function extractUrlFromText(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : null;
}

module.exports = { logPost, extractUrlFromText };
