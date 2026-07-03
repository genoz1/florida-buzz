const express = require('express');
const router = express.Router();
const { supabase } = require('../lib/supabase');

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

const CATEGORY_SEO = {
  'theme-parks': {
    title: 'Disney World & Universal Orlando News',
    description: 'Daily news, ride updates, price changes, and planning tips for Walt Disney World, Universal Orlando, and Central Florida\u2019s theme parks.',
    intro: 'The latest on Walt Disney World, Universal Orlando, and Central Florida\u2019s theme parks \u2014 ride closures, price changes, new attractions, and planning tips.',
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
    description: 'Weather, local culture, and everyday Florida living \u2014 news for residents and transplants alike.',
    intro: 'Weather, local culture, and everyday Florida living \u2014 news for residents and transplants alike.',
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
  return `https://picsum.photos/seed/${seedMap[category] || 'florida'}/800/600`;
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

async function getArticles({ category, limit, evergreenOnly, excludeEvergreen } = {}) {
  if (supabase) {
    let query = supabase.from('articles').select('*').order('published_at', { ascending: false });
    if (category) query = query.eq('category', category);
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
  const rest = all.slice(4);

  const byCategory = {};
  CATEGORY_ORDER.forEach((cat) => {
    byCategory[cat] = rest.filter((a) => a.category === cat).slice(0, 3);
  });

  res.render('home', {
    featured,
    secondary,
    byCategory,
    ticker: all.slice(0, 8),
    categoryLabels: CATEGORY_LABELS,
    placeholderImg,
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
    placeholderImg,
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
      const image = a.image_url || placeholderImg(a.category);
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

module.exports = router;
