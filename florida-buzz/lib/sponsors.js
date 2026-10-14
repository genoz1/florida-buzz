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
const SPONSOR_TIER_DEFS = [
  {
    id: 'supporting',
    name: 'Supporting Sponsor',
    monthlyEquivalentCents: 4900,
    annualCents: 58800,
    amountEnv: 'SPONSOR_SUPPORTING_AMOUNT_CENTS',
    monthlyEnv: 'SPONSOR_SUPPORTING_MONTHLY_EQUIVALENT_CENTS',
    priceEnvKeys: ['STRIPE_PRICE_SUPPORTING', 'STRIPE_PRICE_SPONSOR_SUPPORTING'],
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
    amountEnv: 'SPONSOR_FEATURED_AMOUNT_CENTS',
    monthlyEnv: 'SPONSOR_FEATURED_MONTHLY_EQUIVALENT_CENTS',
    priceEnvKeys: ['STRIPE_PRICE_FEATURED', 'STRIPE_PRICE_SPONSOR_FEATURED'],
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
    amountEnv: 'SPONSOR_PREMIER_AMOUNT_CENTS',
    monthlyEnv: 'SPONSOR_PREMIER_MONTHLY_EQUIVALENT_CENTS',
    priceEnvKeys: ['STRIPE_PRICE_PREMIER', 'STRIPE_PRICE_SPONSOR_PREMIER'],
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

function parseCents(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveSponsorTiers(env = process.env) {
  return SPONSOR_TIER_DEFS.map((tier) => ({
    ...tier,
    annualCents: parseCents(env[tier.amountEnv], tier.annualCents),
    monthlyEquivalentCents: parseCents(env[tier.monthlyEnv], tier.monthlyEquivalentCents),
  }));
}

/** @deprecated use resolveSponsorTiers(env) when amounts may come from env */
const SPONSOR_TIERS = resolveSponsorTiers({});

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

function listSponsorTiers(env = process.env) {
  return resolveSponsorTiers(env);
}

function getTier(tierId, env = process.env) {
  return listSponsorTiers(env).find((t) => t.id === tierId) || null;
}

function stripePriceIdForTier(tierId, env = process.env) {
  const def = SPONSOR_TIER_DEFS.find((t) => t.id === tierId);
  if (!def) return null;
  for (const key of def.priceEnvKeys) {
    if (env[key] && !/REPLACE/i.test(env[key])) return env[key];
  }
  return null;
}

function envFlagTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function stripeConfigured(env = process.env) {
  if (!env.STRIPE_SECRET_KEY || /REPLACE/i.test(env.STRIPE_SECRET_KEY)) return false;
  // Match Florida_Buzz_Sponsor_ENV.example launch gate when present.
  if (
    env.SPONSOR_CHECKOUT_ENABLED != null &&
    env.SPONSOR_CHECKOUT_ENABLED !== '' &&
    !envFlagTrue(env.SPONSOR_CHECKOUT_ENABLED)
  ) {
    return false;
  }
  return SPONSOR_TIER_DEFS.every((tier) => Boolean(stripePriceIdForTier(tier.id, env)));
}

function sponsorsConfig(env = process.env) {
  const featured = SPONSORS.filter((s) => s.featured);
  const partners = SPONSORS.filter((s) => !s.featured);
  const packet = {
    ...SPONSOR_PACKET,
    contactEmail:
      env.SPONSOR_SUPPORT_EMAIL && !/REPLACE/i.test(env.SPONSOR_SUPPORT_EMAIL)
        ? env.SPONSOR_SUPPORT_EMAIL
        : SPONSOR_PACKET.contactEmail,
  };
  return {
    sponsors: SPONSORS,
    featured,
    partners,
    inquireEmail: packet.contactEmail,
    becomePath: '/sponsors/become',
    tiers: listSponsorTiers(env),
    packet,
    stripeReady: stripeConfigured(env),
  };
}

function becomeSponsorPageData(env = process.env) {
  const tiers = listSponsorTiers(env).map((tier) => ({
    ...tier,
    monthlyLabel: formatUsdFromCents(tier.monthlyEquivalentCents),
    annualLabel: formatUsdFromCents(tier.annualCents),
    stripePriceId: stripePriceIdForTier(tier.id, env),
  }));
  const config = sponsorsConfig(env);
  return {
    tiers,
    packet: config.packet,
    stripeReady: stripeConfigured(env),
    defaultTierId: 'featured',
    legalSellerLine:
      env.SPONSOR_LEGAL_SELLER_LINE ||
      'Sponsorships are sold by Cartzilla LLC, doing business as Florida Buzz.',
  };
}

module.exports = {
  SPONSORS,
  SPONSOR_TIERS,
  SPONSOR_TIER_DEFS,
  SPONSOR_PACKET,
  sponsorsConfig,
  becomeSponsorPageData,
  getTier,
  listSponsorTiers,
  formatUsdFromCents,
  stripeConfigured,
  stripePriceIdForTier,
  envFlagTrue,
};
