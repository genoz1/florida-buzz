require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/resend');

const DRY_RUN = process.env.DRY_RUN === 'true';
const PLATFORMS = ['facebook', 'instagram', 'pinterest', 'threads'];

// Uses Resend's shared test sender by default, since ALERT emails to
// yourself shouldn't have to wait on the thefloridabuzz.com domain
// verification that's still blocked by the pending Wix -> Cloudflare
// transfer. Once that domain is verified in Resend, you can set
// ALERT_FROM_EMAIL to something like "Florida Buzz Alerts <alerts@thefloridabuzz.com>"
// instead — everything else keeps working unchanged.
const ALERT_FROM = process.env.ALERT_FROM_EMAIL || 'Florida Buzz Alerts <onboarding@resend.dev>';

async function getLast24hSummary() {
  const summary = {};
  PLATFORMS.forEach((p) => { summary[p] = { success: 0, failed: 0, failures: [] }; });

  if (!supabase) return summary;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('post_log')
    .select('platform, status, detail, created_at')
    .gte('created_at', oneDayAgo)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`  [error] Could not fetch post_log: ${error.message}`);
    return summary;
  }

  (data || []).forEach((row) => {
    if (!summary[row.platform]) return;
    if (row.status === 'success') {
      summary[row.platform].success += 1;
    } else {
      summary[row.platform].failed += 1;
      summary[row.platform].failures.push(row.detail || '(no detail)');
    }
  });

  return summary;
}

function buildEmail(summary) {
  const issues = PLATFORMS.filter((p) => summary[p].success === 0 || summary[p].failed > 0);
  const allGood = issues.length === 0;

  const subject = allGood
    ? '✅ Florida Buzz — all platforms posting normally'
    : `⚠️ Florida Buzz — issue detected: ${issues.join(', ')}`;

  const rows = PLATFORMS.map((p) => {
    const s = summary[p];
    const status = s.success === 0 ? '🔴 No successful posts' : (s.failed > 0 ? '🟡 Some failures' : '🟢 OK');
    return `
      <tr>
        <td style="padding:8px 12px; text-transform:capitalize; font-weight:600;">${p}</td>
        <td style="padding:8px 12px;">${status}</td>
        <td style="padding:8px 12px; text-align:center;">${s.success}</td>
        <td style="padding:8px 12px; text-align:center;">${s.failed}</td>
      </tr>`;
  }).join('');

  const failureDetails = PLATFORMS
    .filter((p) => summary[p].failures.length)
    .map((p) => `<p><strong>${p} errors:</strong><br>${summary[p].failures.slice(0, 5).map((f) => `&bull; ${f}`).join('<br>')}</p>`)
    .join('');

  const html = `
    <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
      <h2 style="color:#0d3b3e;">Daily Posting Health Check</h2>
      <p style="color:#555;">Last 24 hours, as of ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead>
          <tr style="background:#0d3b3e; color:white;">
            <th style="padding:8px 12px; text-align:left;">Platform</th>
            <th style="padding:8px 12px; text-align:left;">Status</th>
            <th style="padding:8px 12px;">✅ Success</th>
            <th style="padding:8px 12px;">❌ Failed</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${failureDetails ? `<div style="margin-top:16px; font-size:13px; color:#b3261e;">${failureDetails}</div>` : ''}
      <p style="margin-top:20px; font-size:12px; color:#999;">Full report: <a href="${process.env.SITE_URL || 'https://thefloridabuzz.com'}/admin/post-report?key=${process.env.ADMIN_PASSWORD || ''}">View live dashboard</a></p>
    </div>`;

  return { subject, html };
}

async function run() {
  console.log(`=== Daily post health check — ${new Date().toISOString()} ===`);

  if (!process.env.ALERT_EMAIL_TO) {
    console.error('[error] ALERT_EMAIL_TO not set — cannot send health check email.');
    process.exit(1);
  }

  const summary = await getLast24hSummary();
  const { subject, html } = buildEmail(summary);

  console.log(`Subject: ${subject}`);
  PLATFORMS.forEach((p) => {
    console.log(`  ${p}: ${summary[p].success} success, ${summary[p].failed} failed`);
  });

  if (DRY_RUN) {
    console.log('\n[dry-run] Would send email to:', process.env.ALERT_EMAIL_TO);
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.log('  [skip] RESEND_API_KEY not set — skipping email send.');
    return;
  }

  try {
    await sendEmail({ to: process.env.ALERT_EMAIL_TO, subject, html, from: ALERT_FROM });
    console.log('  Email sent successfully.');
  } catch (err) {
    console.error(`  [error] Could not send health check email: ${err.message}`);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in post-health-check run:', err);
  process.exit(1);
});
