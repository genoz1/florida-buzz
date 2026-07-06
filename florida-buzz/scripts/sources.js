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
  {
    url: 'https://rss.app/feeds/tmqe2r9o3h5ePgFx.xml',
    category: 'theme-parks',
    name: 'Disney World resorts (mixed)',
    mixedSource: true, // very active — allears.net, disneytouristblog.com, wdwnt.com, insidethemagic.net, mickeyvisit.com, disneyfoodblog.com, and official Disney/press sources
  },
  {
    url: 'https://rss.app/feeds/tadTQJB5j1tLS0NI.xml',
    category: 'food',
    name: 'Disney World food (mixed)',
    mixedSource: true, // mostly disneyfoodblog.com plus allears.net/mickeyvisit.com — Disney dining specifically, distinct from the general Orlando restaurant feed above
  },
  {
    url: 'https://rss.app/feeds/tuElQs5KVtjXxzPM.xml',
    category: 'theme-parks',
    name: 'Legoland Florida news (mixed)',
    mixedSource: true, // this topic feed also carries Legoland California/NY/Michigan/Germany content —
    // relies on the safety filter's Florida-relevance check (added alongside this source) to skip non-Florida items
  },
  {
    url: 'https://rss.app/feeds/t7SwuJdn9DjHB8gZ.xml',
    category: 'cruises',
    name: 'Royal Caribbean Port Canaveral (mixed)',
    mixedSource: true, // tampabay.com, people.com, seattletimes.com, royalcaribbeanpresscenter.com
  },
  {
    url: 'https://rss.app/feeds/trkxfnsThPflXD2D.xml',
    category: 'space',
    name: 'SpaceX Cape Canaveral (mixed)',
    mixedSource: true, // very active — floridatoday.com (dedicated Space Coast beat reporter), orlandosentinel.com,
    // tcpalm.com, naplesnews.com, tallahassee.com, spaceflightnow.com, and SpaceX's own official site
  },
  {
    url: 'https://rss.app/feeds/OH3TPs5E8HmQGnVb.xml',
    category: 'theme-parks',
    name: 'WDWNT',
    // single dedicated site, not a mixed aggregator — no mixedSource/nameFromUrl guessing needed,
    // always attributed to WDWNT directly. Very active, high-volume Disney World news.
  },

  // City-specific events feeds — each tagged with `city` so these can power dedicated
  // city event pages, in addition to the general /category/events page. All are
  // mixedSource since each keyword feed pulls from several real local outlets.
  {
    url: 'https://rss.app/feeds/tDtirk9M7U6xt371.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'Jacksonville events (mixed)',
    mixedSource: true, // WOKV, News4Jax, Florida Politics, First Coast News, Jacksonville.com —
    // occasionally pulls "Jacksonville, Illinois" content too; the Florida-relevance safety check handles that
  },
  {
    url: 'https://rss.app/feeds/tcTBK3DRxT2EhyZd.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'Jacksonville Beach events (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/t0Ar9zjtWdRpShqh.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'Ponte Vedra events (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tnsQqQWMundkdQ36.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'Amelia Island events (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tgLPWfOUOPXOoLZd.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'St. Augustine events (mixed)',
    mixedSource: true, // some overlap with the general Florida festivals feed — dedup by guid handles exact repeats
  },
  {
    url: 'https://rss.app/feeds/tunFpw9PT3ckwPbj.xml',
    category: 'events',
    city: 'tampa',
    name: 'Tampa events (mixed)',
    mixedSource: true, // WUSF, Tampa Bay Times, Fox 13, Patch, Carnival Cruise Line's own announcements
  },
  {
    url: 'https://rss.app/feeds/tKQoaFbTORLngzxW.xml',
    category: 'events',
    city: 'tampa',
    name: 'St. Pete events (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/ticZm2EOKuFqiISV.xml',
    category: 'events',
    city: 'orlando',
    name: 'Orlando events (mixed)',
    mixedSource: true, // mostly civic/community events — minimal theme-park overlap
  },
  {
    url: 'https://rss.app/feeds/t6uJp2Ct5bZIaDSh.xml',
    category: 'events',
    city: 'orlando',
    name: 'Orlando sport events (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tvHLWaW1HhHoNTpk.xml',
    category: 'events',
    city: 'miami',
    name: 'Things to do in Miami (mixed)',
    mixedSource: true, // Timeout Miami, Axios Miami, Miami New Times, Garden & Gun, Business Insider
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
