'use strict';

async function notifyDraftReady({
  episode,
  run,
  settings,
  cfg,
  sendEmail,
  env = process.env,
}) {
  const to = settings.notify_email || env.ALERT_EMAIL_TO || env.PODCASTS_NOTIFY_EMAIL;
  if (!to) {
    console.warn('[podcasts] draft ready but no notify email configured (ALERT_EMAIL_TO / schedule notify_email)');
    return { sent: false, reason: 'no-recipient' };
  }
  if (typeof sendEmail !== 'function') {
    return { sent: false, reason: 'no-mailer' };
  }
  if (!env.RESEND_API_KEY) {
    console.warn('[podcasts] draft ready but RESEND_API_KEY missing — skip email');
    return { sent: false, reason: 'no-resend' };
  }

  const site = (cfg.site || 'https://thefloridabuzz.com').replace(/\/$/, '');
  const adminUrl = `${site}/admin/podcasts/episodes/${episode.id}`;
  const subject = `[Florida Buzz Podcast] Draft ready for review — ${episode.title}`;
  const html = `
    <p>A weekly <strong>Florida Buzz: Disney</strong> podcast draft is ready for your review.</p>
    <ul>
      <li><strong>Title:</strong> ${escape(episode.title)}</li>
      <li><strong>Status:</strong> ${escape(episode.status)} (not published)</li>
      <li><strong>Week:</strong> ${escape(run.week_key)}</li>
      <li><strong>Attempt:</strong> ${Number(run.attempt) || 1}</li>
      <li><strong>Audio:</strong> ${episode.audio_url ? 'attached (preview)' : 'not generated yet — generation flag may be off'}</li>
    </ul>
    <p><a href="${adminUrl}">Review in podcast admin</a></p>
    <p>Nothing was published to the website or RSS feed.</p>
  `;

  await sendEmail({
    to,
    subject,
    html,
    from: env.ALERT_FROM_EMAIL || env.NEWSLETTER_FROM_EMAIL || 'Florida Buzz <newsletter@thefloridabuzz.com>',
  });
  return { sent: true, to };
}

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { notifyDraftReady };
