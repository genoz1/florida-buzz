'use strict';

require('dotenv').config();
const { supabase } = require('../lib/supabase');
const {
  buildWelcomeEmails,
  sendWelcomeStep,
  gapAfterStep,
  recordNurtureStep,
  STEP_DELAYS_MS,
} = require('../lib/email/welcomeSeries');

const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_SENDS = parseInt(process.env.WELCOME_NURTURE_MAX || '40', 10);

async function run() {
  console.log(`=== Welcome nurture run — ${new Date().toISOString()} ===`);

  if (!supabase) {
    console.error('Supabase not configured — cannot run welcome nurture.');
    return;
  }
  if (!process.env.RESEND_API_KEY && !DRY_RUN) {
    console.log('RESEND_API_KEY missing — skipping welcome nurture.');
    return;
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('subscriber_nurture')
    .select('email, step, next_at')
    .not('next_at', 'is', null)
    .lte('next_at', nowIso)
    .gte('step', 0)
    .lt('step', STEP_DELAYS_MS.length - 1)
    .order('next_at', { ascending: true })
    .limit(MAX_SENDS);

  if (error) {
    // Table may not be migrated yet — fail soft so cron never takes down the app.
    console.warn('[welcome-nurture] query skipped:', error.message);
    return;
  }

  if (!due || due.length === 0) {
    console.log('No nurture emails due.');
    return;
  }

  const emails = due.map((row) => row.email);
  const { data: activeRows, error: activeError } = await supabase
    .from('subscribers')
    .select('email')
    .in('email', emails)
    .eq('active', true);

  if (activeError) {
    console.error('Could not verify active subscribers:', activeError.message);
    return;
  }

  const active = new Set((activeRows || []).map((r) => r.email));
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of due) {
    if (!active.has(row.email)) {
      await recordNurtureStep(supabase, row.email, row.step, { nextAt: null });
      skipped++;
      continue;
    }

    const nextStep = Number(row.step) + 1;
    if (nextStep >= STEP_DELAYS_MS.length) {
      await recordNurtureStep(supabase, row.email, row.step, { nextAt: null });
      skipped++;
      continue;
    }

    try {
      const result = await sendWelcomeStep({
        email: row.email,
        step: nextStep,
        dryRun: DRY_RUN,
      });
      if (!result.sent) {
        console.warn(`  skip ${row.email}: ${result.reason}`);
        skipped++;
        continue;
      }

      const gap = gapAfterStep(nextStep);
      const computedNext = gap != null ? new Date(Date.now() + gap) : null;
      await recordNurtureStep(supabase, row.email, nextStep, { nextAt: computedNext });
      console.log(`  ${DRY_RUN ? '[dry-run] ' : ''}sent step ${nextStep} → ${row.email}`);
      sent++;
    } catch (err) {
      console.error(`  [error] ${row.email}: ${err.message}`);
      failed++;
    }
  }

  if (DRY_RUN && due[0]) {
    const preview = buildWelcomeEmails(process.env, { email: due[0].email });
    console.log(`Preview series length: ${preview.length} emails`);
  }

  console.log(`\n=== Done: ${sent} sent, ${skipped} skipped, ${failed} failed ===`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal error in welcome nurture run:', err);
    process.exit(1);
  });
}

module.exports = { run };
