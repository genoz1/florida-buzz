// Official, reputable sources only — per the original brief, this is what keeps us
// on the right side of copyright (we summarize + link back, never copy).

module.exports = [
  // CONFIRMED WORKING as of the first live test run (July 2026):
  { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'space', name: 'NASA' },
  {
    url: 'https://rss.app/feeds/t0EWr4IpNbId7gMY.xml',
    category: 'theme-parks',
    name: 'Disney blogs (mixed)',
    mixedSource: true, // pulls from Disney Parks Blog + independent fan sites — attribute per-article, not to one fixed name
  },
  {
    url: 'https://rss.app/feeds/t1kxNdMt6YHMBt6G.xml',
    category: 'theme-parks',
    name: 'Universal Orlando blogs (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/trmkgJaBIXkr8mGp.xml',
    category: 'wildlife',
    name: 'Florida wildlife news (mixed)',
    mixedSource: true, // local news coverage — the safety filter screens out attack/tragedy stories
    preferAI: true, // real photos from orgs like Live Wildly can have baked-in borders/branding
  },
  {
    url: 'https://rss.app/feeds/tLphQShMugwaR7ui.xml',
    category: 'beaches',
    name: 'Florida beaches news (mixed)',
    mixedSource: true,
    preferAI: true, // same risk as wildlife — mixed local news sources with inconsistent photo styling
  },
  {
    url: 'https://rss.app/feeds/tvYOAhQRw6xwta3w.xml',
    category: 'events',
    name: 'Florida festivals & events (mixed)',
    mixedSource: true,
    preferAI: true, // source images here are often promotional graphics/banners, not real photos — bad hero-image material
  },
  {
    url: 'https://rss.app/feeds/tmBqHlnbyDVRIqnl.xml',
    category: 'food',
    name: 'Orlando restaurant news (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tVXNguf66O8zGJpB.xml',
    category: 'theme-parks',
    name: 'Disney Vacations (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tZHmgfK0Qz7zYI29.xml',
    category: 'florida-living',
    name: 'Florida state parks news (mixed)',
    mixedSource: true, // occasional serious wildlife-incident stories mixed in — the safety filter handles those
  },
  {
    url: 'https://rss.app/feeds/tQSaP9Jh08uDlp6X.xml',
    category: 'florida-living',
    name: 'Florida vacation secrets (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/taJC69mJkbPUrRnX.xml',
    category: 'cruises',
    name: 'Disney Cruise Line (mixed)',
    mixedSource: true, // mostly clean DCL news/deals; a couple of items per month are serious enough for the safety filter to (correctly) skip
  },

  // NOT added — the "florida cruise news" keyword feed was dominated by a disturbing
  // active criminal case (not appropriate for this site regardless of the safety filter,
  // since it was the majority of the feed's content, not an occasional item to skip).
  // If you want cruise content, a narrower feed pointed at an actual cruise-line blog
  // (e.g. Royal Caribbean's or Carnival's official blog) would be a better source.

  // REMOVED after testing — these returned 403/404 errors:
  // - Kennedy Space Center, Florida State Parks, FWC, NWS Melbourne, Visit Florida
  // None of these publish a simple public RSS feed at a predictable URL. FWC in particular
  // only offers email subscriptions (GovDelivery), not RSS at all.
  //
  // TO ADD MORE SOURCES: the reliable path is a feed-generator service like RSS.app or
  // FetchRSS — point it at the source's news/blog page (e.g. myfwc.com/news/all-news/,
  // floridastateparks.org, visitflorida.com/travel-ideas, disneyparksblog.com,
  // universalorlandoblog.com) and it hands you back a stable RSS URL to paste in below.
  // Most have a free tier that covers a handful of feeds, which is all this needs.
];
