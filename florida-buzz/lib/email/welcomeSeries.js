'use strict';

const { sendEmail } = require('../resend');
const {
  getActiveOffers,
  siteTools,
  offerEmailHtml,
  toolsEmailHtml,
  escapeHtml,
} = require('../affiliates');

const SITE_URL = () => (process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
const FROM_EMAIL = () =>
  process.env.NEWSLETTER_FROM_EMAIL || 'Florida Buzz <newsletter@thefloridabuzz.com>';

/** Delay before each step after subscribe (step 0 sends immediately). */
const STEP_DELAYS_MS = [
  0,
  2 * 24 * 60 * 60 * 1000, // day 2
  4 * 24 * 60 * 60 * 1000, // day 4
  7 * 24 * 60 * 60 * 1000, // day 7
];

function shellHtml({ title, dek, bodyHtml, unsubscribeUrl }) {
  return `
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f2e8d5;padding:24px;">
    <div style="background:#0e3b43;padding:24px;text-align:center;border-radius:4px 4px 0 0;">
      <h1 style="color:#f8f3e8;font-family:Georgia,serif;margin:0;font-size:26px;">Florida <span style="color:#ff6452;font-style:italic;">Buzz</span></h1>
      <p style="color:#f2e8d5;font-size:13px;margin:6px 0 0;">${escapeHtml(dek)}</p>
    </div>
    <div style="background:#f8f3e8;padding:24px;border-radius:0 0 4px 4px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#0e3b43;margin:0 0 12px;">${escapeHtml(title)}</h2>
      ${bodyHtml}
    </div>
    <p style="text-align:center;font-size:11px;color:#4a5350;margin-top:16px;">
      You're getting this because you signed up at thefloridabuzz.com.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#4a5350;">Unsubscribe</a>
    </p>
  </div>`;
}

function buildWelcomeEmails(env = process.env, { email, unsubscribeUrl } = {}) {
  const siteUrl = (env.SITE_URL || SITE_URL()).replace(/\/$/, '');
  const tools = siteTools(siteUrl);
  const offers = getActiveOffers(env, { placement: 'email', limit: 2 });
  const unsub = unsubscribeUrl || `${siteUrl}/unsubscribe?email=${encodeURIComponent(email || '')}`;

  const steps = [
    {
      step: 0,
      subject: 'Welcome to Florida Buzz — start with these free trip tools',
      title: 'Glad you’re here',
      dek: 'Your Florida trip toolkit',
      bodyHtml: `
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:0 0 14px;">
          Thanks for joining the Florida Buzz list. We’ll send a short daily roundup when there’s news worth your time —
          and these free tools are ready whenever you’re planning a Disney or Florida trip.
        </p>
        ${toolsEmailHtml(tools)}
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:18px 0 8px;">
          Bookmark <a href="${escapeHtml(siteUrl)}" style="color:#0e3b43;font-weight:700;">thefloridabuzz.com</a> —
          wait times, the day planner, and Gene’s guides live there year-round.
        </p>
        ${offers.map(offerEmailHtml).join('')}
      `,
    },
    {
      step: 1,
      subject: 'Park-day tip: live waits + a printable day plan',
      title: 'Two tools that save a park day',
      dek: 'Planning tip',
      bodyHtml: `
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:0 0 14px;">
          When dates firm up, start here: check live waits the week of your visit, then build a printable day plan around dining and Lightning Lane times.
        </p>
        ${toolsEmailHtml(tools.filter((t) => t.id === 'wait-times' || t.id === 'planner'))}
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:18px 0 0;">
          Tip: rank must-do rides in the planner first, then drop dining reservations into the timeline so you’re not guessing on the day.
        </p>
        ${offerEmailHtml(offers[0])}
      `,
    },
    {
      step: 2,
      subject: 'Evergreen guides for the Florida trip you’re mapping',
      title: 'Go deeper with original guides',
      dek: 'Guides & booking',
      bodyHtml: `
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:0 0 14px;">
          Our evergreen guides are researched for real trip decisions — parks, dining, and Florida logistics —
          written by Gene Zentko, not recycled press releases.
        </p>
        ${toolsEmailHtml(tools.filter((t) => t.id === 'guides'))}
        <p style="margin:16px 0;">
          <a href="${escapeHtml(siteUrl + '/guides')}" style="background:#ff6452;color:white;padding:12px 20px;border-radius:3px;text-decoration:none;font-weight:700;font-size:14px;">Browse original guides</a>
        </p>
        ${offers.map(offerEmailHtml).join('')}
      `,
    },
    {
      step: 3,
      subject: 'You’re set — keep Florida Buzz in your planning loop',
      title: 'You’re on the list',
      dek: 'One more note',
      bodyHtml: `
        <p style="font-size:15px;color:#4a5350;line-height:1.55;margin:0 0 14px;">
          That’s the short welcome series. From here you’ll get the daily digest when we publish —
          and you can always jump back into wait times, the day planner, guides, and the Florida Buzz: Disney podcast.
        </p>
        ${toolsEmailHtml(tools)}
        <p style="margin:16px 0;">
          <a href="${escapeHtml(siteUrl + '/podcasts')}" style="background:#0e3b43;color:#f8f3e8;padding:12px 20px;border-radius:3px;text-decoration:none;font-weight:700;font-size:14px;">Listen to Florida Buzz: Disney</a>
        </p>
        ${offerEmailHtml(offers[0])}
        <p style="font-size:12px;color:#4a5350;margin:16px 0 0;line-height:1.45;">
          Florida Buzz is an independent fan publication — not affiliated with Disney or Universal.
          Partner links include a disclosure; booking through them helps keep the free tools running.
        </p>
      `,
    },
  ];

  return steps.map((step) => ({
    ...step,
    html: shellHtml({
      title: step.title,
      dek: step.dek,
      bodyHtml: step.bodyHtml,
      unsubscribeUrl: unsub,
    }),
  }));
}

function buildWelcomeEmail(env = process.env, options = {}) {
  return buildWelcomeEmails(env, options)[0];
}

async function sendWelcomeEmail({ email, env = process.env, dryRun = false } = {}) {
  if (!email || !String(email).includes('@')) {
    return { sent: false, reason: 'invalid_email' };
  }
  if (!env.RESEND_API_KEY && !dryRun) {
    return { sent: false, reason: 'missing_resend' };
  }

  const siteUrl = (env.SITE_URL || SITE_URL()).replace(/\/$/, '');
  const unsubscribeUrl = `${siteUrl}/unsubscribe?email=${encodeURIComponent(email)}`;
  const message = buildWelcomeEmail(env, { email, unsubscribeUrl });

  if (dryRun) {
    return { sent: true, dryRun: true, subject: message.subject, html: message.html, step: 0 };
  }

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    from: FROM_EMAIL(),
  });
  return { sent: true, subject: message.subject, step: 0 };
}

async function sendWelcomeStep({ email, step, env = process.env, dryRun = false } = {}) {
  const messages = buildWelcomeEmails(env, {
    email,
    unsubscribeUrl: `${(env.SITE_URL || SITE_URL()).replace(/\/$/, '')}/unsubscribe?email=${encodeURIComponent(email)}`,
  });
  const message = messages.find((m) => m.step === step);
  if (!message) return { sent: false, reason: 'unknown_step' };
  if (!env.RESEND_API_KEY && !dryRun) return { sent: false, reason: 'missing_resend' };

  if (dryRun) {
    return { sent: true, dryRun: true, subject: message.subject, html: message.html, step };
  }

  await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    from: FROM_EMAIL(),
  });
  return { sent: true, subject: message.subject, step };
}

function nextStepAt(fromDate = new Date(), nextStep = 1) {
  const delay = STEP_DELAYS_MS[nextStep];
  if (delay == null) return null;
  return new Date(fromDate.getTime() + delay);
}

/** Gap after completing `completedStep` before sending `completedStep + 1`. */
function gapAfterStep(completedStep) {
  const current = STEP_DELAYS_MS[completedStep];
  const following = STEP_DELAYS_MS[completedStep + 1];
  if (current == null || following == null) return null;
  return Math.max(following - current, 24 * 60 * 60 * 1000);
}

/**
 * Persist / advance nurture state. Uses subscriber_nurture table when available;
 * never throws — signup and digest must keep working if the table is not migrated yet.
 */
async function recordNurtureStep(supabase, email, step, { nextAt } = {}) {
  if (!supabase || !email) return { ok: false, reason: 'missing_client' };
  const payload = {
    email: String(email).toLowerCase().trim(),
    step,
    next_at: nextAt ? new Date(nextAt).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  try {
    const { error } = await supabase.from('subscriber_nurture').upsert(payload, { onConflict: 'email' });
    if (error) {
      console.warn('[welcome-series] nurture upsert skipped:', error.message);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[welcome-series] nurture upsert failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

async function afterSubscribeWelcome(supabase, email, { env = process.env, dryRun = false } = {}) {
  let sendResult;
  try {
    sendResult = await sendWelcomeEmail({ email, env, dryRun });
  } catch (err) {
    console.error('[welcome-series] welcome send failed:', err.message);
    sendResult = { sent: false, reason: err.message };
  }

  if (sendResult.sent) {
    const gap = gapAfterStep(0);
    const nextAt = gap != null ? new Date(Date.now() + gap) : nextStepAt(new Date(), 1);
    await recordNurtureStep(supabase, email, 0, { nextAt });
  }
  return sendResult;
}

module.exports = {
  STEP_DELAYS_MS,
  buildWelcomeEmails,
  buildWelcomeEmail,
  sendWelcomeEmail,
  sendWelcomeStep,
  nextStepAt,
  gapAfterStep,
  recordNurtureStep,
  afterSubscribeWelcome,
  shellHtml,
};
