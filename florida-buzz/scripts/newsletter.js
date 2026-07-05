require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/resend');

const SITE_URL = process.env.SITE_URL || 'https://thefloridabuzz.com';
const DRY_RUN = process.env.DRY_RUN === 'true';

const CATEGORY_LABELS = {
  'theme-parks': '🏰 Theme Parks',
  space: '🚀 Space',
  beaches: '🏖 Beaches',
  'florida-living': '🌴 Florida Living',
  wildlife: '🦩 Wildlife',
  cruises: '🚢 Cruises',
  food: '🍔 Food',
  events: '🎉 Events',
};

function buildDigestHtml(articles) {
  const rows = articles
    .map(
      (a) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #e5ddc8;">
        <span style="font-family: monospace; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: #3f6b4f;">${CATEGORY_LABELS[a.category] || a.category}</span>
        <h2 style="font-family: Georgia, serif; font-size: 20px; margin: 6px 0 6px; color: #0e3b43;">
          <a href="${SITE_URL}/article/${a.slug}" style="color: #0e3b43; text-decoration: none;">${a.title}</a>
        </h2>
        <p style="font-size: 15px; color: #4a5350; margin: 0;">${a.dek}</p>
      </td>
    </tr>`
    )
    .join('');

  return `
  <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, sans-serif; background: #f2e8d5; padding: 24px;">
    <div style="background: #0e3b43; padding: 24px; text-align: center; border-radius: 4px 4px 0 0;">
      <h1 style="color: #f8f3e8; font-family: Georgia, serif; margin: 0; font-size: 26px;">Florida <span style="color: #ff6452; font-style: italic;">Buzz</span></h1>
      <p style="color: #f2e8d5; font-size: 13px; margin: 6px 0 0;">Today's roundup</p>
    </div>
    <div style="background: #f8f3e8; padding: 8px 24px; border-radius: 0 0 4px 4px;">
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${SITE_URL}" style="background: #ff6452; color: white; padding: 12px 24px; border-radius: 3px; text-decoration: none; font-weight: bold; font-size: 14px;">See everything on the site</a>
      </p>
    </div>
    <p style="text-align: center; font-size: 11px; color: #4a5350; margin-top: 16px;">
      You're getting this because you signed up at thefloridabuzz.com.
    </p>
  </div>`;
}

async function run() {
  console.log(`=== Newsletter digest run — ${new Date().toISOString()} ===`);

  if (!supabase) {
    console.error('Supabase not configured — cannot run newsletter.');
    return;
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('*')
    .gte('published_at', oneDayAgo)
    .order('published_at', { ascending: false })
    .limit(10);

  if (articlesError) {
    console.error('Could not fetch articles:', articlesError.message);
    return;
  }

  if (!articles || articles.length === 0) {
    console.log('No articles published in the past day — skipping send.');
    return;
  }

  console.log(`Found ${articles.length} articles from the past day.`);

  const { data: subscribers, error: subsError } = await supabase
    .from('subscribers')
    .select('email')
    .eq('active', true);

  if (subsError) {
    console.error('Could not fetch subscribers:', subsError.message);
    return;
  }

  if (!subscribers || subscribers.length === 0) {
    console.log('No active subscribers — skipping send.');
    return;
  }

  console.log(`Sending to ${subscribers.length} subscribers...`);
  const html = buildDigestHtml(articles);
  const subject = `Florida Buzz: ${articles.length} stories from today`;

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    if (DRY_RUN) {
      console.log(`  [dry-run] Would send to: ${sub.email}`);
      sent++;
      continue;
    }
    try {
      await sendEmail({ to: sub.email, subject, html });
      sent++;
    } catch (err) {
      console.error(`  [error] Failed to send to ${sub.email}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${sent} sent, ${failed} failed ===`);
}

run().catch((err) => {
  console.error('Fatal error in newsletter run:', err);
  process.exit(1);
});
