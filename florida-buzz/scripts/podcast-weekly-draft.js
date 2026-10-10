#!/usr/bin/env node
'use strict';

/**
 * Weekly Florida Buzz Disney podcast draft runner.
 * Creates a review draft only — never publishes to the site or RSS.
 * Audio generation requires PODCASTS_GENERATION_ENABLED=true.
 */

require('dotenv').config();

const { config, production, createWeeklyDraft } = require('../lib/podcasts');

async function main() {
  const force = process.argv.includes('--force') || process.env.FORCE === 'true';
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
  const cfg = config(process.env);
  if (!cfg.enabled) {
    console.log('[podcast-weekly-draft] PODCASTS_ENABLED=false — exiting');
    return;
  }

  const runtime = production(process.env);
  let sendEmail = null;
  try {
    sendEmail = require('../lib/resend').sendEmail;
  } catch {
    sendEmail = null;
  }
  let supabase = null;
  try {
    supabase = require('../lib/supabase').supabase;
  } catch {
    supabase = null;
  }

  if (dryRun) {
    const settings = (await runtime.store.getScheduleSettings()) || {};
    console.log('[podcast-weekly-draft] dry-run', {
      weekly_draft_enabled: settings.weekly_draft_enabled,
      generate_weekday: settings.generate_weekday,
      generate_hour: settings.generate_hour,
      generation: cfg.generation,
      force,
    });
    return;
  }

  const result = await createWeeklyDraft({
    store: runtime.store,
    supabase,
    cfg: runtime.cfg,
    aiText: runtime.aiText,
    pipeline: runtime.pipeline,
    sendEmail,
    env: process.env,
    force,
  });
  console.log('[podcast-weekly-draft] result', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[podcast-weekly-draft] failed:', err.message);
  process.exitCode = 1;
});
