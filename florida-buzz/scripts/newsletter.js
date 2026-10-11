require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/resend');
const { newsletterMonetizationHtml, siteTools, escapeHtml } = require('../lib/affiliates');

const SITE_URL = (process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
const DRY_RUN = process.env.DRY_RUN === 'true';

const CATEGORY_LABELS = {
  'theme-parks': 'Theme Parks',
  space: 'Space',
  beaches: 'Beaches',
  'florida-living': 'Florida Living',
  wildlife: 'Wildlife',
  cruises: 'Cruises',
  food: 'Food',
  events: 'Events',
  'travel-deals': 'Travel Deals',
};

function isDisneyParkStory(article) {
  const hay = `${article?.title || ''} ${article?.dek || ''} ${article?.slug || ''}`.toLowerCase();
  if (article?.category === 'theme-parks') {
    // Prefer Disney-tagged park news; still allow Universal in the Disney-focused block
    // when it's a major Orlando park story.
    return /disney|magic kingdom|epcot|hollywood studios|animal kingdom|disney springs|universal|epic universe|islands of adventure|seaworld|legoland|orlando park/.test(hay)
      || article.category === 'theme-parks';
  }
  return /disney|magic kingdom|epcot|hollywood studios|animal kingdom|lightning lane|disney world/.test(hay);
}

function isStrongDisney(article) {
  const hay = `${article?.title || ''} ${article?.dek || ''} ${article?.slug || ''}`.toLowerCase();
  return /disney|magic kingdom|epcot|hollywood studios|animal kingdom|lightning lane|disney springs|walt disney/.test(hay);
}

function emailImageUrl(article) {
  const url = String(article?.image_url || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/-thumb\./i.test(url)) return url;
  return url.replace(/(\.[a-zA-Z0-9]+)(\?.*)?$/i, '-thumb$1$2');
}

function articleUrl(slug) {
  return `${SITE_URL}/article/${encodeURIComponent(slug)}`;
}

function formatDateLabel(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);
}

function normalizeDigestInput(input) {
  if (Array.isArray(input)) {
    const disneyNews = input.filter(isDisneyParkStory).slice(0, 5);
    const moreNews = input.filter((a) => !disneyNews.includes(a)).slice(0, 4);
    return {
      hero: disneyNews[0] || input[0] || null,
      disneyNews: disneyNews.slice(disneyNews[0] ? 1 : 0),
      tipGuide: null,
      moreNews,
      tools: siteTools(SITE_URL),
    };
  }
  return {
    hero: input?.hero || null,
    disneyNews: input?.disneyNews || [],
    tipGuide: input?.tipGuide || null,
    moreNews: input?.moreNews || [],
    tools: input?.tools || siteTools(SITE_URL),
  };
}

function storyRow(article, { withImage = false } = {}) {
  if (!article?.slug) return '';
  const img = withImage ? emailImageUrl(article) : null;
  const cat = escapeHtml(CATEGORY_LABELS[article.category] || article.category || 'Florida');
  const title = escapeHtml(article.title || 'Untitled');
  const dek = escapeHtml(article.dek || '');
  const href = articleUrl(article.slug);
  return `
    <tr>
      <td style="padding:18px 0;border-bottom:1px solid #e5ddc8;">
        ${img ? `
        <a href="${href}" style="display:block;margin:0 0 12px;text-decoration:none;">
          <img src="${escapeHtml(img)}" alt="" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:4px;border:0;">
        </a>` : ''}
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#3f6b4f;margin:0 0 6px;">${cat}</div>
        <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.25;margin:0 0 8px;color:#0e3b43;">
          <a href="${href}" style="color:#0e3b43;text-decoration:none;">${title}</a>
        </h2>
        ${dek ? `<p style="font-size:15px;line-height:1.45;color:#4a5350;margin:0 0 10px;">${dek}</p>` : ''}
        <a href="${href}" style="font-size:13px;font-weight:700;color:#ff6452;text-decoration:none;">Read more →</a>
      </td>
    </tr>`;
}

function tipSection(guide) {
  if (!guide?.slug) return '';
  const img = emailImageUrl(guide);
  const href = articleUrl(guide.slug);
  return `
    <tr>
      <td style="padding:22px 0 8px;">
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#ff6452;margin:0 0 8px;">Disney tip of the day</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5ddc8;border-radius:4px;">
          <tr>
            ${img ? `
            <td style="width:42%;padding:0;vertical-align:top;">
              <a href="${href}" style="display:block;text-decoration:none;">
                <img src="${escapeHtml(img)}" alt="" width="220" style="display:block;width:100%;height:auto;border:0;border-radius:4px 0 0 4px;">
              </a>
            </td>` : ''}
            <td style="padding:16px 16px 18px;vertical-align:top;">
              <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.25;margin:0 0 8px;color:#0e3b43;">
                <a href="${href}" style="color:#0e3b43;text-decoration:none;">${escapeHtml(guide.title)}</a>
              </h2>
              <p style="font-size:14px;line-height:1.45;color:#4a5350;margin:0 0 12px;">${escapeHtml(guide.dek || 'A practical planning guide from Gene Zentko.')}</p>
              <a href="${href}" style="display:inline-block;background:#0e3b43;color:#f8f3e8;padding:10px 14px;border-radius:3px;text-decoration:none;font-size:13px;font-weight:700;">Get the tip →</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function toolsSection(tools) {
  const rows = (tools || []).map((tool) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5ddc8;">
        <a href="${escapeHtml(tool.url)}" style="color:#0e3b43;font-weight:700;text-decoration:none;font-size:15px;">${escapeHtml(tool.label)}</a>
        <div style="font-size:13px;color:#4a5350;margin-top:2px;">${escapeHtml(tool.blurb)}</div>
      </td>
    </tr>`).join('');
  return `
    <tr>
      <td style="padding:22px 0 4px;">
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#3f6b4f;margin:0 0 10px;">Plan with free tools</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td>
    </tr>`;
}

function sectionLabel(text) {
  return `
    <tr>
      <td style="padding:22px 0 4px;">
        <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#3f6b4f;">${escapeHtml(text)}</div>
      </td>
    </tr>`;
}

function buildDigestHtml(input, unsubscribeUrl, env = process.env) {
  const digest = normalizeDigestInput(input);
  const hero = digest.hero;
  const disneyRows = (digest.disneyNews || []).map((a) => storyRow(a, { withImage: false })).join('');
  const moreRows = (digest.moreNews || []).map((a) => storyRow(a, { withImage: false })).join('');
  const monetization = newsletterMonetizationHtml(env, { siteUrl: SITE_URL });
  const dateLabel = formatDateLabel();

  return `
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#e8dfcf;padding:20px 12px;">
    <div style="background:#0e3b43;padding:26px 24px 22px;text-align:center;border-radius:6px 6px 0 0;">
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#f2e8d5;margin:0 0 8px;">${escapeHtml(dateLabel)}</div>
      <h1 style="color:#f8f3e8;font-family:Georgia,'Times New Roman',serif;margin:0;font-size:28px;line-height:1.15;">Florida <span style="color:#ff6452;font-style:italic;">Buzz</span></h1>
      <p style="color:#f2e8d5;font-size:14px;margin:8px 0 0;line-height:1.4;">Disney planning tips, park news, and Florida trip help — curated for your inbox.</p>
    </div>
    <div style="background:#f8f3e8;padding:8px 22px 22px;border-radius:0 0 6px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${hero ? `${sectionLabel('Disney & parks today')}${storyRow(hero, { withImage: true })}` : ''}
        ${disneyRows ? `${sectionLabel('More Disney & Orlando parks')}${disneyRows}` : ''}
        ${tipSection(digest.tipGuide)}
        ${toolsSection(digest.tools)}
        ${moreRows ? `${sectionLabel('Also in Florida')}${moreRows}` : ''}
      </table>
      ${monetization}
      <p style="text-align:center;margin:28px 0 8px;">
        <a href="${SITE_URL}/wait-times" style="display:inline-block;background:#ff6452;color:#fff;padding:12px 20px;border-radius:3px;text-decoration:none;font-weight:700;font-size:14px;margin:0 6px 8px;">Live wait times</a>
        <a href="${SITE_URL}/guides" style="display:inline-block;background:#0e3b43;color:#f8f3e8;padding:12px 20px;border-radius:3px;text-decoration:none;font-weight:700;font-size:14px;margin:0 6px 8px;">Planning guides</a>
      </p>
    </div>
    <p style="text-align:center;font-size:11px;color:#4a5350;margin:16px 8px 0;line-height:1.45;">
      You're getting this because you signed up at thefloridabuzz.com.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#4a5350;">Unsubscribe</a>
    </p>
  </div>`;
}

function buildDigestSubject(digest, now = new Date()) {
  const hero = digest?.hero;
  if (hero?.title) {
    const short = String(hero.title).replace(/\s+/g, ' ').trim();
    if (short.length <= 55) return `Disney Buzz: ${short}`;
    return `Disney Buzz: ${short.slice(0, 52).trim()}…`;
  }
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  }).format(now);
  return `Disney Buzz for ${day}: tips, waits & park news`;
}

/**
 * Pull a Disney-first digest: park news + evergreen tip + lighter Florida extras.
 */
async function collectDigestContent(client = supabase, { now = new Date() } = {}) {
  if (!client) throw new Error('Supabase not configured');

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: recent, error: recentError }, { data: guides, error: guidesError }] = await Promise.all([
    client
      .from('articles')
      .select('slug,title,dek,category,image_url,published_at,is_evergreen')
      .eq('is_evergreen', false)
      .gte('published_at', oneDayAgo)
      .order('published_at', { ascending: false })
      .limit(24),
    client
      .from('articles')
      .select('slug,title,dek,category,image_url,published_at,is_evergreen')
      .eq('is_evergreen', true)
      .gte('published_at', twoWeeksAgo)
      .order('published_at', { ascending: false })
      .limit(20),
  ]);

  if (recentError) throw new Error(recentError.message);
  if (guidesError) throw new Error(guidesError.message);

  const news = recent || [];
  const disneyRanked = [
    ...news.filter(isStrongDisney),
    ...news.filter((a) => isDisneyParkStory(a) && !isStrongDisney(a)),
  ];
  // de-dupe preserving order
  const seen = new Set();
  const disneyNewsAll = disneyRanked.filter((a) => {
    if (seen.has(a.slug)) return false;
    seen.add(a.slug);
    return true;
  });

  const hero = disneyNewsAll[0] || news[0] || null;
  const disneyNews = disneyNewsAll.filter((a) => a.slug !== hero?.slug).slice(0, 4);
  const used = new Set([hero?.slug, ...disneyNews.map((a) => a.slug)].filter(Boolean));
  const moreNews = news.filter((a) => !used.has(a.slug)).slice(0, 3);

  const tipCandidates = (guides || []).filter((g) => {
    const hay = `${g.title} ${g.dek} ${g.slug}`.toLowerCase();
    return g.category === 'theme-parks'
      || g.category === 'travel-deals'
      || /disney|universal|hotel|itinerary|planner|lightning|park|orlando|cruise|port canaveral/.test(hay);
  });
  const tipScore = (g) => {
    const hay = `${g.title} ${g.slug}`.toLowerCase();
    let score = 0;
    if (/disney/.test(hay)) score += 5;
    if (/hotel|itinerary|planner|lightning|rope drop|wait/.test(hay)) score += 3;
    if (/universal/.test(hay)) score += 1;
    if (g.image_url) score += 1;
    return score;
  };
  const tipGuide = [...tipCandidates].sort((a, b) => tipScore(b) - tipScore(a))[0]
    || (guides || [])[0]
    || null;

  if (!hero && !tipGuide && moreNews.length === 0) {
    return null;
  }

  return {
    hero,
    disneyNews,
    tipGuide,
    moreNews,
    tools: siteTools(SITE_URL),
  };
}

async function run() {
  console.log(`=== Newsletter digest run — ${new Date().toISOString()} ===`);

  if (!supabase) {
    console.error('Supabase not configured — cannot run newsletter.');
    return;
  }

  let digest;
  try {
    digest = await collectDigestContent(supabase);
  } catch (err) {
    console.error('Could not build digest content:', err.message);
    return;
  }

  if (!digest) {
    console.log('No articles/guides available for today — skipping send.');
    return;
  }

  const storyCount = [digest.hero, ...digest.disneyNews, ...digest.moreNews].filter(Boolean).length;
  console.log(`Digest ready: hero=${digest.hero?.slug || 'none'}, disney=${digest.disneyNews.length}, tip=${digest.tipGuide?.slug || 'none'}, more=${digest.moreNews.length}`);

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
  const subject = buildDigestSubject(digest);

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const unsubscribeUrl = `${SITE_URL}/unsubscribe?email=${encodeURIComponent(sub.email)}`;
    const html = buildDigestHtml(digest, unsubscribeUrl);
    if (DRY_RUN) {
      console.log(`  [dry-run] Would send to: ${sub.email}`);
      console.log(`  [dry-run] Subject: ${subject}`);
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

  console.log(`\n=== Done: ${sent} sent, ${failed} failed (${storyCount} news items + tip) ===`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal error in newsletter run:', err);
    process.exit(1);
  });
}

module.exports = {
  buildDigestHtml,
  buildDigestSubject,
  collectDigestContent,
  normalizeDigestInput,
  isDisneyParkStory,
  isStrongDisney,
  emailImageUrl,
};
