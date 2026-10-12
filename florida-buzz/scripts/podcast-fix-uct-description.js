#!/usr/bin/env node
'use strict';

/**
 * Rewrite podcast episode descriptions / show notes that still paste the raw
 * CJ Undercover Tourist URL. Replaces with https://thefloridabuzz.com/go/undercover
 *
 * Usage: node scripts/podcast-fix-uct-description.js [--dry-run]
 */

const { createClient } = require('@supabase/supabase-js');
const { rewritePartnerDescriptionLink } = require('../lib/affiliates/undercoverTourist');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL || process.env.FLORIDA_BUZZ_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  }
  const supabase = createClient(url, key);
  const { data: episodes, error } = await supabase
    .from('podcast_episodes')
    .select('id, title, slug, description, show_notes_html, status')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  let updated = 0;
  for (const ep of episodes || []) {
    const nextDescription = rewritePartnerDescriptionLink(ep.description || '');
    const nextNotes = rewritePartnerDescriptionLink(ep.show_notes_html || '');
    const descChanged = nextDescription !== (ep.description || '');
    const notesChanged = nextNotes !== (ep.show_notes_html || '');
    if (!descChanged && !notesChanged) continue;

    console.log(`${dryRun ? '[dry-run] ' : ''}Fix ${ep.slug || ep.id}: ${ep.title}`);
    if (descChanged) {
      console.log('  description: replaced CJ/UCT URL with /go/undercover');
    }
    if (notesChanged) {
      console.log('  show_notes_html: replaced CJ/UCT URL with /go/undercover');
    }
    if (!dryRun) {
      const patch = {};
      if (descChanged) patch.description = nextDescription;
      if (notesChanged) patch.show_notes_html = nextNotes;
      const { error: upErr } = await supabase.from('podcast_episodes').update(patch).eq('id', ep.id);
      if (upErr) throw upErr;
    }
    updated += 1;
  }
  console.log(`${dryRun ? 'Would update' : 'Updated'} ${updated} episode(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
