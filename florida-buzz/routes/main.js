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

function placeholderImg(category) {
  // picsum.photos with a seed keeps the same image per category (consistent look)
  // until you wire up real AI-generated featured images per article.
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

// ---- Sample data so the site looks complete before the automation has run ----
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

async function getArticles({ category, limit } = {}) {
  if (supabase) {
    let query = supabase.from('articles').select('*').order('published_at', { ascending: false });
    if (category) query = query.eq('category', category);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (!error && data && data.length) return data;
  }
  // Fallback to sample data if Supabase isn't configured yet or has no rows
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

  res.render('category', {
    category: cat,
    articles,
    ticker,
    categoryLabels: CATEGORY_LABELS,
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

router.post('/subscribe', async (req, res) => {
  // Placeholder — wire up to an email provider (Mailchimp, Resend, Supabase table) later.
  console.log('Newsletter signup:', req.body.email);
  res.redirect('/?subscribed=1');
});

module.exports = router;
