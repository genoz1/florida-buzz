// Official, reputable sources only — per the original brief, this is what keeps us
// on the right side of copyright (we summarize + link back, never copy).
// Verify each feed URL still resolves periodically — official orgs sometimes change RSS paths.

module.exports = [
  // Verified working as of this build:
  { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'space', name: 'NASA' },

  // NOT YET VERIFIED — I wrote these from the most likely official RSS path, but
  // I did not confirm each one resolves. Run `npm run automate:dry` after setup
  // and check the console output: any feed that 404s or returns empty will be
  // logged so you know which ones to fix or replace. Do this BEFORE turning on
  // live posting so you're not silently missing categories.
  { url: 'https://www.kennedyspacecenter.com/feed', category: 'space', name: 'Kennedy Space Center' },
  { url: 'https://www.floridastateparks.org/rss.xml', category: 'florida-living', name: 'Florida State Parks' },
  { url: 'https://myfwc.com/news/rss/', category: 'wildlife', name: 'Florida Fish & Wildlife' },
  { url: 'https://www.weather.gov/source/mlb/mlbrss.xml', category: 'florida-living', name: 'National Weather Service (Melbourne)' },
  { url: 'https://www.visitflorida.com/en-us/travel-ideas.rss', category: 'florida-living', name: 'Visit Florida' },

  // Disney Parks Blog, Universal Orlando Blog, and cruise line newsrooms don't
  // publish reliable public RSS feeds — they change often and aren't consistent.
  // Best fix: use a feed-generator service (e.g. RSS.app or FetchRSS) pointed at
  // their blog/news page, which gives you a stable RSS URL to drop in here.
  // I'm not adding a guessed URL for these — better to leave them out than silently break.
];
