'use strict';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function notifyDraftReady({
  episode,
  episodes,
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
  const list = Array.isArray(episodes) && episodes.length ? episodes : episode ? [episode] : [];
  const primary = list[0] || episode;
  const adminUrl = `${site}/admin/podcasts/episodes/${primary.id}`;
  const subject =
    list.length > 1
      ? `[Florida Buzz Podcast] ${list.length} standalone drafts ready — week ${run.week_key}`
      : `[Florida Buzz Podcast] Draft ready for review — ${primary.title}`;
  const episodeRows = list
    .map((ep) => {
      const day =
        ep.intended_publish_weekday != null
          ? WEEKDAY_NAMES[Number(ep.intended_publish_weekday)] || 'Release day'
          : ep.outline_json?.release_label || '—';
      const epUrl = `${site}/admin/podcasts/episodes/${ep.id}`;
      return `<li><strong>${escape(ep.title)}</strong> — intended ${escape(day)} · <a href="${epUrl}">Open</a></li>`;
    })
    .join('');
  const html = `
    <p>Standalone <strong>Florida Buzz: Disney</strong> podcast draft(s) are ready for review (not Part 1/Part 2 of one show).</p>
    <ul>
      <li><strong>Week:</strong> ${escape(run.week_key)}</li>
      <li><strong>Attempt:</strong> ${Number(run.attempt) || 1}</li>
      <li><strong>Episodes:</strong> ${list.length} (intended Tuesday + Friday; auto-publish off)</li>
    </ul>
    <ul>${episodeRows}</ul>
    <p><a href="${adminUrl}">Review in podcast admin</a></p>
    <p>Nothing was published to the website or RSS feed. Generate fal TTS per episode when ready.</p>
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
