/**
 * Florida Buzz sponsors — curated partner listings for /sponsors
 * and the become-a-sponsor packet / tier catalog.
 */

const SPONSORS = [
  {
    id: 'rook-careers',
    name: 'Rook Careers',
    featured: true,
    tagline: 'Florida-minded careers, without the noise',
    description:
      'Rook Careers helps job seekers find roles that fit — with a focus on clear listings, practical guidance, and less résumé roulette. Proud to support Florida Buzz as our first partner.',
    url: 'https://rookcareers.com',
    logoUrl: '/images/sponsors/rook-careers.png',
    logoAlt: 'Rook Careers logo',
    ctaLabel: 'Visit Rook Careers',
  },
];

/** Annual founding-sponsor tiers (monthly equivalent shown for clarity). */
const SPONSOR_TIERS = [
  {
    id: 'supporting',
    name: 'Supporting Sponsor',
    monthlyEquivalentCents: 4900,
    annualCents: 58800,
    highlight: false,
    benefits: [
      { label: 'Sponsor listing on website', included: true },
      { label: 'Logo and website link', included: true },
      { label: 'Sponsor recognition on podcast page', included: true },
      { label: 'Website advertising placement', included: false },
      { label: 'Podcast sponsor mentions', included: false, detail: null },
      { label: 'Featured sponsor spotlight', included: false },
      { label: 'Founding sponsor rate locked for 12 months', included: true },
    ],
  },
  {
    id: 'featured',
    name: 'Featured Sponsor',
    monthlyEquivalentCents: 9900,
    annualCents: 118800,
    highlight: true,
    benefits: [
      { label: 'Sponsor listing on website', included: true },
      { label: 'Logo and website link', included: true },
      { label: 'Sponsor recognition on podcast page', included: true },
      { label: 'Website advertising placement', included: true },
      { label: 'Podcast sponsor mentions', included: true, detail: '2 per month' },
      { label: 'Featured sponsor spotlight', included: false },
      { label: 'Founding sponsor rate locked for 12 months', included: true },
    ],
  },
  {
    id: 'premier',
    name: 'Premier Sponsor',
    monthlyEquivalentCents: 19900,
    annualCents: 238800,
    highlight: false,
    benefits: [
      { label: 'Sponsor listing on website', included: true },
      { label: 'Logo and website link', included: true },
      { label: 'Sponsor recognition on podcast page', included: true },
      { label: 'Website advertising placement', included: true },
      { label: 'Podcast sponsor mentions', included: true, detail: '4 per month' },
      { label: 'Featured sponsor spotlight', included: true, detail: 'Quarterly' },
      { label: 'Founding sponsor rate locked for 12 months', included: true },
    ],
  },
];

const SPONSOR_PACKET = {
  title: 'Florida Buzz Sponsor Packet',
  subtitle: 'Founding sponsor rates — locked for 12 months',
  audience:
    'Florida Buzz reaches readers and listeners who care about theme parks, travel, Florida living, and Sunshine State news — through the website, daily newsletter, and Florida Buzz podcasts.',
  highlights: [
    'Annual sponsorship with founding rates locked for twelve months',
    'Listing on the Florida Buzz sponsors page with your logo and link',
    'Podcast-page recognition, with mention frequency by tier',
    'Optional website advertising placement on Featured and Premier',
    'Independent editorial — sponsorship never buys coverage',
  ],
  contactEmail: 'floridabuzzonline@gmail.com',
};

function formatUsdFromCents(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function getTier(tierId) {
  return SPONSOR_TIERS.find((t) => t.id === tierId) || null;
}

function stripePriceEnvKey(tierId) {
  return `STRIPE_PRICE_SPONSOR_${String(tierId || '').toUpperCase()}`;
}

function stripeConfigured(env = process.env) {
  if (!env.STRIPE_SECRET_KEY) return false;
  return SPONSOR_TIERS.every((tier) => Boolean(env[stripePriceEnvKey(tier.id)]));
}

function sponsorsConfig() {
  const featured = SPONSORS.filter((s) => s.featured);
  const partners = SPONSORS.filter((s) => !s.featured);
  return {
    sponsors: SPONSORS,
    featured,
    partners,
    inquireEmail: SPONSOR_PACKET.contactEmail,
    becomePath: '/sponsors/become',
    tiers: SPONSOR_TIERS,
    packet: SPONSOR_PACKET,
    stripeReady: stripeConfigured(),
  };
}

function becomeSponsorPageData(env = process.env) {
  return {
    tiers: SPONSOR_TIERS.map((tier) => ({
      ...tier,
      monthlyLabel: formatUsdFromCents(tier.monthlyEquivalentCents),
      annualLabel: formatUsdFromCents(tier.annualCents),
      stripePriceId: env[stripePriceEnvKey(tier.id)] || null,
    })),
    packet: SPONSOR_PACKET,
    stripeReady: stripeConfigured(env),
    defaultTierId: 'featured',
  };
}

module.exports = {
  SPONSORS,
  SPONSOR_TIERS,
  SPONSOR_PACKET,
  sponsorsConfig,
  becomeSponsorPageData,
  getTier,
  formatUsdFromCents,
  stripeConfigured,
  stripePriceEnvKey,
};
