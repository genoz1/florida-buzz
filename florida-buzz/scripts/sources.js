// Official, reputable sources only — per the original brief, this is what keeps us
// on the right side of copyright (we summarize + link back, never copy).
//
// ORDER MATTERS: sources are checked top-to-bottom each run, and each successful
// Facebook post adds a 10-minute wait before the next one (see FB_POST_DELAY_MINUTES
// in automate.js). With enough sources, a long run can get cut short by the next
// scheduled run or a deploy before reaching the bottom of this list — so priority
// order is: theme parks first, then the city-specific event feeds, then beaches,
// then everything else.

module.exports = [
  // ── THEME PARKS ─────────────────────────────────────────────────────────
  {
    url: 'https://rss.app/feeds/t0EWr4IpNbId7gMY.xml',
    category: 'theme-parks',
    name: 'Disney blogs (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/t1kxNdMt6YHMBt6G.xml',
    category: 'theme-parks',
    name: 'Universal Orlando blogs (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tVXNguf66O8zGJpB.xml',
    category: 'theme-parks',
    name: 'Disney Vacations (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tmqe2r9o3h5ePgFx.xml',
    category: 'theme-parks',
    name: 'Disney World resorts (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tuElQs5KVtjXxzPM.xml',
    category: 'theme-parks',
    name: 'Legoland Florida news (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/OH3TPs5E8HmQGnVb.xml',
    category: 'theme-parks',
    name: 'WDWNT',
  },
  {
    url: 'https://rss.app/feeds/TSa5MAwulqAkalmW.xml',
    category: 'theme-parks',
    name: 'WDWMAGIC',
  },

  // ── CITY EVENTS ─────────────────────────────────────────────────────────
  {
    url: 'https://rss.app/feeds/tDtirk9M7U6xt371.xml',
    category: 'events',
    city: 'jacksonville',
    name: 'Jacksonville events (mixed)',
    mixedSource: true,
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
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tunFpw9PT3ckwPbj.xml',
    category: 'events',
    city: 'tampa',
    name: 'Tampa events (mixed)',
    mixedSource: true,
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
    mixedSource: true,
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
    mixedSource: true,
  },

  // ── BEACHES ─────────────────────────────────────────────────────────────
  {
    url: 'https://rss.app/feeds/tLphQShMugwaR7ui.xml',
    category: 'beaches',
    name: 'Florida beaches news (mixed)',
    mixedSource: true,
    preferAI: true,
  },

  // ── EVERYTHING ELSE ─────────────────────────────────────────────────────
  { url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss', category: 'space', name: 'NASA' },
  {
    url: 'https://rss.app/feeds/trkxfnsThPflXD2D.xml',
    category: 'space',
    name: 'SpaceX Cape Canaveral (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/trmkgJaBIXkr8mGp.xml',
    category: 'wildlife',
    name: 'Florida wildlife news (mixed)',
    mixedSource: true,
    preferAI: true,
  },
  {
    url: 'https://rss.app/feeds/tvYOAhQRw6xwta3w.xml',
    category: 'events',
    name: 'Florida festivals & events (mixed)',
    mixedSource: true,
    preferAI: true,
  },
  {
    url: 'https://rss.app/feeds/tmBqHlnbyDVRIqnl.xml',
    category: 'food',
    name: 'Orlando restaurant news (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tadTQJB5j1tLS0NI.xml',
    category: 'food',
    name: 'Disney World food (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/tZHmgfK0Qz7zYI29.xml',
    category: 'florida-living',
    name: 'Florida state parks news (mixed)',
    mixedSource: true,
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
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/t7SwuJdn9DjHB8gZ.xml',
    category: 'cruises',
    name: 'Royal Caribbean Port Canaveral (mixed)',
    mixedSource: true,
  },
  {
    url: 'https://rss.app/feeds/w6p0MQtag8GrTY2H.xml',
    category: 'cruises',
    name: 'Royal Caribbean Blog',
  },
];
