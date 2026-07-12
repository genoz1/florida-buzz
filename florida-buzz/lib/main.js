const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');
const { spawn } = require('child_process');
const path = require('path');

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
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

const CITY_LABELS = {
  jacksonville: 'Jacksonville Area',
  tampa: 'Tampa Bay',
  orlando: 'Orlando',
  miami: 'Miami',
};
const CITY_ORDER = Object.keys(CITY_LABELS);

const CITY_SEO = {
  jacksonville: {
    title: 'Jacksonville Area Events & Things to Do',
    description: 'Festivals, concerts, and local events in Jacksonville, Jacksonville Beach, Ponte Vedra, Amelia Island, and St. Augustine.',
    intro: 'Festivals, concerts, and local events across Northeast Florida — Jacksonville, Jacksonville Beach, Ponte Vedra, Amelia Island, and St. Augustine.',
  },
  tampa: {
    title: 'Tampa Bay Events & Things to Do',
    description: 'Festivals, concerts, and local events in Tampa and St. Petersburg.',
    intro: 'Festivals, concerts, and local events across the Tampa Bay area — Tampa and St. Petersburg.',
  },
  orlando: {
    title: 'Orlando Events & Things to Do',
    description: 'Local festivals, concerts, sports, and community events in and around Orlando, beyond the theme parks.',
    intro: 'Local festivals, concerts, sports, and community events in and around Orlando — separate from our theme park coverage.',
  },
  miami: {
    title: 'Miami Events & Things to Do',
    description: 'Festivals, concerts, and local events in and around Miami.',
    intro: 'Festivals, concerts, and local events in and around Miami.',
  },
};

const CATEGORY_SEO = {
  'theme-parks': {
    title: 'Disney World & Universal Orlando News',
    description: 'Daily news, ride updates, price changes, and planning tips for Walt Disney World, Universal Orlando, and Central Florida\u2019s theme parks.',
    intro: 'The latest on Walt Disney World, Universal Orlando, and Central Florida\u2019s theme parks — ride closures, price changes, new attractions, and planning tips.',
  },
  space: {
    title: 'Florida Space Launches & NASA News',
    description: 'Launch schedules, NASA updates, and Space Coast news from Cape Canaveral and Kennedy Space Center.',
    intro: 'Live launch schedules, NASA updates, and Space Coast news from Cape Canaveral and Kennedy Space Center.',
  },
  beaches: {
    title: 'Florida Beaches Guide & News',
    description: 'Beach conditions, top spots, and coastal news from the Gulf Coast to the Atlantic side of Florida.',
    intro: 'Beach conditions, top spots, and coastal news from the Gulf Coast to the Atlantic side of Florida.',
  },
  'florida-living': {
    title: 'Florida Living News & Lifestyle',
    description: 'Weather, local culture, and everyday Florida living — news for residents and transplants alike.',
    intro: 'Weather, local culture, and everyday Florida living — news for residents and transplants alike.',
  },
  wildlife: {
    title: 'Florida Wildlife News',
    description: 'Manatee sightings, gator news, conservation updates, and wildlife encounters from across Florida.',
    intro: 'Manatee sightings, gator news, conservation updates, and wildlife encounters from across Florida.',
  },
  cruises: {
    title: 'Florida Cruise News',
    description: 'Port Canaveral and Florida cruise line news, new itineraries, and sailing updates.',
    intro: 'Port Canaveral and Florida cruise line news, new itineraries, and sailing updates.',
  },
  food: {
    title: 'Florida Food & Restaurant News',
    description: 'New restaurants, food festivals, and dining news from across Florida.',
    intro: 'New restaurants, food festivals, and dining news from across Florida.',
  },
  events: {
    title: 'Florida Events & Festivals',
    description: 'Festivals, fireworks, holiday events, and things to do across Florida.',
    intro: 'Festivals, fireworks, holiday events, and things to do across Florida.',
  },
};

// Pillar pages: hand-curated "hub" pages that round up every guide on a
// specific subject in one place, with internal links to each. Good for SEO
// (signals topical authority) once linked. For now these are sitemap-only —
// not linked from anywhere in the site nav/UI — until affiliate links are
// set up. Adding a new pillar is just a new entry here — no new routes,
// templates, or DB fields needed. `keywords` are matched case-insensitively
// against each guide's title/dek within `category` to decide what belongs.
const PILLARS = {
  'disney-world-planning': {
    title: 'The Complete Walt Disney World Planning Guide',
    description:
      "Every Walt Disney World guide we've published, in one place — tickets and park hopping, hotels, dining, and the money-saving strategies worth knowing before you book.",
    category: 'theme-parks',
    keywords: ['disney', 'magic kingdom', 'epcot', 'hollywood studios', 'animal kingdom', 'walt disney world'],
  },
};

function placeholderImg(category) {
  const seedMap = {
    'theme-parks': 'fc-theme-parks',
    space: 'fc-space',
    beaches: 'fc-beaches',
    'florida-living': 'fc-florida-living',
    wildlife: 'fc-wildlife',
    cruises: 'fc-cruises',
    food: 'fc-food',
    events: 'fc-events',
  };
  return `https://picsum.photos/seed/${seedMap[category] || 'florida'}/1600/900`;
}

// Rewrites a Supabase Storage URL to request a resized/compressed version via
// Supabase's built-in image transformation endpoint, instead of serving the
// full-size original (AI-generated images are 1536x1024; real downloaded
// photos can be several MB) on every single page view. This is what was
// driving Supabase bandwidth usage well over the free tier's monthly limit.
// Non-Supabase URLs (e.g. the picsum.photos placeholders) pass through
// untouched — they're already small and hosted elsewhere.
function resizeImg(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('/storage/v1/object/public/')) return url;
  const rendered = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const sep = rendered.includes('?') ? '&' : '?';
  return `${rendered}${sep}width=${width}&quality=75`;
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sampleArticles() {
  const now = new Date();
  const mk = (i, category, title, dek, source) => ({
    slug: `sample-${category}-${i}`,
    title,
    dek,
    body_html: `<p>This is placeholder content. Once the automation is connected to Supabase and the RSS sources, real articles will replace this sample.</p><p>${dek}</p>`,
    category,
    source_name: source,
    source_url: '#',
    image_url: null,
    featured: i === 0,
    published_at: new Date(now - i * 3600000).toISOString(),
  });

  return [
    mk(0, 'theme-parks', 'Disney Unveils New Holiday Parade for Magic Kingdom', 'A first look at the new floats, music, and characters coming this winter season.', 'Disney Parks Blog'),
    mk(1, 'space', 'SpaceX Targets Tonight for Falcon 9 Launch from the Cape', 'Here is the best viewing spot if you want to catch tonight\'s liftoff from the Space Coast.', 'NASA'),
    mk(2, 'beaches', 'Five Quiet Florida Beaches Locals Don\'t Want You to Know About', 'Skip the crowds at these lesser-known stretches of sand from the Panhandle to the Keys.', 'Visit Florida'),
    mk(3, 'wildlife', 'Rare Manatee Gathering Spotted Near Crystal River', 'Wildlife officials confirm an unusually large pod has moved into the springs this week.', 'Florida Fish & Wildlife'),
    mk(4, 'theme-parks', 'Universal Epic Universe Adds New Seasonal Event', 'Universal Orlando has announced details for its next limited-time experience.', 'Universal Orlando Blog'),
    mk(5, 'florida-living', 'Cold Front to Bring Rare Chill to Central Florida This Week', 'Temperatures could dip into the 40s overnight across several counties.', 'National Weather Service'),
    mk(6, 'cruises', 'New Cruise Itinerary Launches from Port Canaveral', 'A major cruise line just added a new four-night Bahamas sailing.', 'Cruise Line News'),
    mk(7, 'events', 'Fourth of July Fireworks Guide: Best Shows Across Florida', 'Our roundup of the top fireworks displays from Pensacola to Miami.', 'Visit Florida'),
  ];
}

async function hasAnyRealArticles() {
  if (!supabase) return false;
  const { count } = await supabase.from('articles').select('*', { count: 'exact', head: true });
  return !!count && count > 0;
}

async function getArticles({ category, city, limit, evergreenOnly, excludeEvergreen } = {}) {
  if (supabase) {
    let query = supabase.from('articles').select('*').order('published_at', { ascending: false });
    if (category) query = query.eq('category', category);
    if (city) query = query.eq('city', city);
    if (evergreenOnly) query = query.eq('is_evergreen', true);
    if (excludeEvergreen) query = query.eq('is_evergreen', false);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (!error && data && data.length) return data;
  }

  const hasReal = await hasAnyRealArticles();
  if (hasReal) return [];

  let sample = sampleArticles();
  if (category) sample = sample.filter((a) => a.category === category);
  return limit ? sample.slice(0, limit) : sample;
}

router.get('/', async (req, res) => {
  const all = await getArticles({ limit: 30 });
  const featured = all[0];
  const secondary = all.slice(1, 4);

  const byCategory = {};
  await Promise.all(
    CATEGORY_ORDER.map(async (cat) => {
      const categoryArticles = await getArticles({ category: cat, limit: 6 });
      // Exclude anything already shown in the featured/secondary slots above,
      // so the same article doesn't appear twice on the homepage.
      const usedSlugs = new Set([featured, ...secondary].filter(Boolean).map((a) => a.slug));
      byCategory[cat] = categoryArticles.filter((a) => !usedSlugs.has(a.slug)).slice(0, 3);
    })
  );

  res.render('home', {
    featured,
    secondary,
    byCategory,
    ticker: all.slice(0, 8),
    categoryLabels: CATEGORY_LABELS,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/category/:cat', async (req, res) => {
  const { cat } = req.params;
  if (!CATEGORY_LABELS[cat]) return res.status(404).render('404');

  const articles = await getArticles({ category: cat });
  const ticker = await getArticles({ limit: 8 });
  const seo = CATEGORY_SEO[cat] || {};

  res.render('category', {
    category: cat,
    articles,
    ticker,
    categoryLabels: CATEGORY_LABELS,
    seoTitle: seo.title,
    seoDescription: seo.description,
    seoIntro: seo.intro,
    cityLabels: cat === 'events' ? CITY_LABELS : null,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/city/:city', async (req, res) => {
  const { city } = req.params;
  if (!CITY_LABELS[city]) return res.status(404).render('404');

  const articles = await getArticles({ city });
  const ticker = await getArticles({ limit: 8 });
  const seo = CITY_SEO[city] || {};

  res.render('city', {
    city,
    articles,
    ticker,
    cityLabels: CITY_LABELS,
    categoryLabels: CATEGORY_LABELS,
    seoTitle: seo.title,
    seoDescription: seo.description,
    seoIntro: seo.intro,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/article/:slug', async (req, res) => {
  const { slug } = req.params;
  const all = await getArticles({ limit: 200 });
  const article = all.find((a) => a.slug === slug);
  if (!article) return res.status(404).render('404');

  const related = all.filter((a) => a.category === article.category && a.slug !== slug).slice(0, 3);
  const ticker = all.slice(0, 8);

  res.render('article', {
    article,
    related,
    ticker,
    categoryLabels: CATEGORY_LABELS,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/guides', async (req, res) => {
  const guides = await getArticles({ evergreenOnly: true, limit: 50 });
  const ticker = await getArticles({ limit: 8 });

  res.render('guides', {
    guides,
    ticker,
    categoryLabels: CATEGORY_LABELS,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/guide/:pillarSlug', async (req, res) => {
  const { pillarSlug } = req.params;
  const pillar = PILLARS[pillarSlug];
  if (!pillar) return res.status(404).render('404');

  const categoryGuides = await getArticles({ category: pillar.category, evergreenOnly: true, limit: 200 });
  const keywordRegex = new RegExp(pillar.keywords.join('|'), 'i');
  const guides = categoryGuides.filter((g) => keywordRegex.test(g.title) || keywordRegex.test(g.dek));
  const ticker = await getArticles({ limit: 8 });

  res.render('pillar', {
    pillar,
    pillarSlug,
    guides,
    ticker,
    categoryLabels: CATEGORY_LABELS,
    placeholderImg,
    resizeImg,
    timeAgo,
  });
});

router.get('/privacy', (req, res) => {
  res.render('privacy');
});

router.get('/about', (req, res) => {
  res.render('about');
});

router.get('/terms', (req, res) => {
  res.render('terms');
});

router.post('/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.redirect('/?subscribed=error');
  }
  if (supabase) {
    const { error } = await supabase.from('subscribers').upsert(
      { email: email.toLowerCase().trim(), active: true },
      { onConflict: 'email' }
    );
    if (error) {
      console.error('Newsletter signup error:', error.message);
      return res.redirect('/?subscribed=error');
    }
  }
  res.redirect('/?subscribed=1');
});

function escapeXml(str) {
  return (str || '').replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function cdata(str) {
  return `<![CDATA[${(str || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function guessImageMime(url) {
  if (!url) return 'image/jpeg';
  if (url.endsWith('.png')) return 'image/png';
  if (url.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// Full-content RSS feed of real site articles — this is what Flipboard (and
// similar RSS-based distribution platforms) needs to pull from. Flipboard
// specifically requires: full content (not just an excerpt), at least one
// image per item, and enough items in the feed for review. All handled here.
router.get('/feed.xml', async (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com';
  const articles = (await getArticles({ limit: 50 })).filter((a) => !a.slug.startsWith('sample-'));

  const items = articles
    .map((a) => {
      const url = `${siteUrl}/article/${a.slug}`;
      const pubDate = new Date(a.published_at).toUTCString();
      const image = resizeImg(a.image_url || placeholderImg(a.category), 1000);
      const fullBody = image ? `<img src="${image}" alt="${escapeXml(a.title)}" />\n${a.body_html}` : a.body_html;

      return `  <item>
    <title>${escapeXml(a.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <pubDate>${pubDate}</pubDate>
    <category>${escapeXml(CATEGORY_LABELS[a.category] || a.category)}</category>
    <description>${cdata(a.dek)}</description>
    <content:encoded>${cdata(fullBody)}</content:encoded>
    ${image ? `<enclosure url="${image}" type="${guessImageMime(image)}" length="0" />` : ''}
  </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>The Florida Buzz</title>
  <link>${siteUrl}</link>
  <description>Florida travel, theme parks, beaches, and lifestyle news and guides.</description>
  <language>en-us</language>
  <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${siteUrl}/feed.xml" rel="self" type="application/rss+xml" />
${items}
</channel>
</rss>`;

  res.set('Content-Type', 'application/rss+xml; charset=UTF-8');
  res.send(xml);
});

router.get('/sitemap.xml', async (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com';
  const articles = await getArticles({ limit: 1000 });

  const staticUrls = [
    { loc: siteUrl, priority: '1.0' },
    ...CATEGORY_ORDER.map((cat) => ({ loc: `${siteUrl}/category/${cat}`, priority: '0.8' })),
    ...CITY_ORDER.map((city) => ({ loc: `${siteUrl}/city/${city}`, priority: '0.7' })),
    ...Object.keys(PILLARS).map((slug) => ({ loc: `${siteUrl}/guide/${slug}`, priority: '0.8' })),
    { loc: `${siteUrl}/about`, priority: '0.5' },
    { loc: `${siteUrl}/privacy`, priority: '0.3' },
    { loc: `${siteUrl}/terms`, priority: '0.3' },
  ];

  const articleUrls = articles
    .filter((a) => !a.slug.startsWith('sample-'))
    .map((a) => ({
      loc: `${siteUrl}/article/${a.slug}`,
      lastmod: new Date(a.published_at).toISOString().split('T')[0],
      priority: '0.6',
    }));

  const allUrls = [...staticUrls, ...articleUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

router.get('/robots.txt', (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com';
  res.set('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml`);
});

// Required by AdSense once approved. ADSENSE_CLIENT_ID should be the full
// value Google gives you, like "ca-pub-1234567890123456" — this route pulls
// out just the "pub-..." part ads.txt expects. Returns an empty file (still
// valid) until the env var is set, so this is safe to deploy ahead of time.
router.get('/ads.txt', (req, res) => {
  res.set('Content-Type', 'text/plain');
  const clientId = process.env.ADSENSE_CLIENT_ID; // e.g. "ca-pub-1234567890123456"
  if (!clientId) return res.send('');
  const pubId = clientId.replace(/^ca-/, '');
  res.send(`google.com, ${pubId}, DIRECT, f08c47fec0942fa0`);
});

// Simple password-gated form to manually trigger evergreen guide generation
// on a specific topic, instead of waiting for the random daily picker or
// running commands by hand in the DigitalOcean console. Protected by
// ADMIN_PASSWORD env var — set that before using this in production.
router.get('/admin/submit-topic', (req, res) => {
  const { key } = req.query;

  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return res.status(404).render('404');
  }

  res.render('admin-submit-topic', {
    categoryLabels: CATEGORY_LABELS,
    result: null,
    error: null,
    adminKey: key,
  });
});

router.post('/admin/submit-topic', (req, res) => {
  const { key, category, topic, title } = req.body;

  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return res.status(404).render('404');
  }

  if (!category || !topic || !title) {
    return res.render('admin-submit-topic', {
      categoryLabels: CATEGORY_LABELS,
      result: null,
      error: 'Please fill in category, topic, and title.',
      adminKey: key,
    });
  }

  // Fire the guide generator in the background and respond immediately —
  // research + writing + image generation can take a couple minutes, well
  // past a typical HTTP request timeout, so we don't wait for it here.
  const scriptPath = path.join(__dirname, '..', 'scripts', 'generate-guide.js');
  const child = spawn('node', [scriptPath], {
    env: {
      ...process.env,
      FORCE_CATEGORY: category,
      FORCE_TOPIC: topic,
      FORCE_TITLE: title,
    },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  res.render('admin-submit-topic', {
    categoryLabels: CATEGORY_LABELS,
    result: `Started generating "${title}" in the background. This takes a couple minutes — check the site or your Facebook Page shortly to confirm it published.`,
    error: null,
    adminKey: key,
  });
});

// Reporting dashboard showing post volume and success/failure per platform,
// for the last 24 hours and rolling 7 days. Reads from post_log, which is
// written automatically by lib/facebook.js, lib/pinterest.js,
// lib/instagram.js, and lib/threads.js on every real post attempt.
// Password-gated the same way as /admin/submit-topic.
const PLATFORMS = ['facebook', 'instagram', 'pinterest', 'threads'];

router.get('/admin/post-report', async (req, res) => {
  const { key } = req.query;

  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return res.status(404).render('404');
  }

  let logs = [];
  if (supabase) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('post_log')
      .select('platform, status, detail, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(`  [error] Could not fetch post_log: ${error.message}`);
    } else {
      logs = data || [];
    }
  }

  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

  const summary = {};
  PLATFORMS.forEach((platform) => {
    summary[platform] = {
      last24h: { success: 0, failed: 0 },
      last7d: { success: 0, failed: 0 },
    };
  });

  logs.forEach((row) => {
    if (!summary[row.platform]) return; // ignore unexpected platform values
    const bucket = summary[row.platform];
    const isRecent = new Date(row.created_at).getTime() >= oneDayAgoMs;
    const statusKey = row.status === 'success' ? 'success' : 'failed';
    bucket.last7d[statusKey] += 1;
    if (isRecent) bucket.last24h[statusKey] += 1;
  });

  const recentFailures = logs.filter((row) => row.status === 'failed').slice(0, 20);

  res.render('admin-post-report', {
    summary,
    platforms: PLATFORMS,
    recentFailures,
    hasData: !!supabase,
    adminKey: key,
  });
});

module.exports = router;
