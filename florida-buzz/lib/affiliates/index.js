'use strict';

const {
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  undercoverTouristUrl,
  undercoverTouristTrackedUrl,
  escapeHtml,
} = require('./undercoverTourist');

const GENERIC_DISCLOSURE =
  'Some links are partner/affiliate links. If you book or buy through them, we may earn a commission at no extra cost to you.';

/**
 * Optional env-driven partner slots. Only shown when a real URL is configured —
 * never invent network IDs or placeholder affiliate programs.
 *
 * Supported env vars:
 *   TRAVEL_INSURANCE_URL  – full tracked URL for travel insurance
 *   AIRPORT_TRANSFER_URL  – full tracked URL for airport transfers / shuttles
 *   PARKING_DEALS_URL     – full tracked URL for parking / transportation deals
 *   UNDERCOVER_TOURIST_URL / UNDERCOVER_TOURIST_LINK – UCT (always available via CJ base)
 *   AMAZON_ASSOCIATES_TAG – used only when building Amazon search links in content pipelines
 */
const OPTIONAL_OFFER_ENV = [
  {
    id: 'travel-insurance',
    envKey: 'TRAVEL_INSURANCE_URL',
    label: 'Travel insurance',
    eyebrow: 'Protect the trip',
    blurb: 'Compare trip protection before you finalize flights and park tickets.',
    cta: 'Compare travel insurance →',
    placements: ['planner', 'article', 'email', 'newsletter'],
  },
  {
    id: 'airport-transfer',
    envKey: 'AIRPORT_TRANSFER_URL',
    label: 'Airport transfer',
    eyebrow: 'Getting there',
    blurb: 'Skip the rental-car hassle with airport-to-resort transfer options.',
    cta: 'See transfer options →',
    placements: ['planner', 'wait-times', 'email', 'newsletter'],
  },
  {
    id: 'parking-deals',
    envKey: 'PARKING_DEALS_URL',
    label: 'Parking & transport',
    eyebrow: 'Park day logistics',
    blurb: 'Check parking and ground-transport options before a busy park day.',
    cta: 'Check parking options →',
    placements: ['wait-times', 'planner', 'newsletter'],
  },
];

function amazonAssociatesTag(env = process.env) {
  return String(env.AMAZON_ASSOCIATES_TAG || 'floridabuzz-20').trim() || 'floridabuzz-20';
}

function amazonSearchUrl(query, env = process.env) {
  const q = String(query || '').trim();
  if (!q) return null;
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(amazonAssociatesTag(env))}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function undercoverOffer(env = process.env, { placement = 'default', variant = 'tickets' } = {}) {
  const key = placement === 'wait-times' || placement === 'planner' ? 'disney-world' : 'disney';
  const url =
    placement === 'home' || placement === 'email' || placement === 'newsletter'
      ? undercoverTouristUrl(env)
      : undercoverTouristTrackedUrl(env, { key, variant, preferReadyUrl: true });

  const copyByPlacement = {
    'wait-times': {
      eyebrow: 'Before you go',
      blurb: 'Watching waits? Compare ticket prices for your dates so the day plan matches what you paid for.',
      cta: 'Compare Disney tickets →',
    },
    planner: {
      eyebrow: 'Tickets & hotels',
      blurb: 'Building a park day? Soft-check ticket and hotel package prices before you lock lodging.',
      cta: 'Check ticket & hotel deals →',
    },
    article: {
      eyebrow: 'Planning a trip?',
      blurb: 'Compare current Disney ticket and hotel deals before you book.',
      cta: 'Check deals at Undercover Tourist →',
    },
    email: {
      eyebrow: 'Optional booking help',
      blurb: 'When you are ready to book, our partner Undercover Tourist lists Disney tickets and hotel deals.',
      cta: 'Browse Disney ticket deals →',
    },
    newsletter: {
      eyebrow: 'Trip booking',
      blurb: 'Compare Disney tickets and hotels with our booking partner when you are ready.',
      cta: 'See current deals →',
    },
    home: {
      eyebrow: 'Book tickets & hotels',
      blurb: 'Compare Disney World ticket and hotel deals before you lock in dates — a Florida Buzz planning partner.',
      cta: 'Check deals at Undercover Tourist →',
    },
    default: {
      eyebrow: 'Tickets & hotels',
      blurb: 'Compare Disney ticket and hotel deals with our booking partner.',
      cta: 'Check deals →',
    },
  };

  const copy = copyByPlacement[placement] || copyByPlacement.default;
  return {
    id: 'undercover-tourist',
    partner: PARTNER_NAME,
    url,
    disclosure: AFFILIATE_DISCLOSURE_SHORT,
    soft: true,
    ...copy,
  };
}

function optionalOffers(env = process.env, { placement = 'default' } = {}) {
  return OPTIONAL_OFFER_ENV.flatMap((def) => {
    if (placement !== 'default' && !def.placements.includes(placement)) return [];
    const url = String(env[def.envKey] || '').trim();
    if (!isHttpUrl(url)) return [];
    return [
      {
        id: def.id,
        partner: def.label,
        url,
        eyebrow: def.eyebrow,
        blurb: def.blurb,
        cta: def.cta,
        disclosure: GENERIC_DISCLOSURE,
        soft: true,
        envKey: def.envKey,
      },
    ];
  });
}

/**
 * Active offers for a placement. UCT is always included (soft secondary CTA).
 * Extra partners appear only when their env URL is set.
 */
function getActiveOffers(env = process.env, { placement = 'default', limit = 3 } = {}) {
  const offers = [undercoverOffer(env, { placement }), ...optionalOffers(env, { placement })];
  return offers.slice(0, Math.max(1, limit));
}

function getPrimaryOffer(env = process.env, options = {}) {
  return getActiveOffers(env, { ...options, limit: 1 })[0] || null;
}

function siteTools(siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com') {
  const base = String(siteUrl || 'https://thefloridabuzz.com').replace(/\/$/, '');
  return [
    {
      id: 'wait-times',
      label: 'Live wait times',
      url: `${base}/wait-times`,
      blurb: 'Disney World & Universal Orlando waits, updated through the day.',
    },
    {
      id: 'planner',
      label: 'Disney day planner',
      url: `${base}/planner`,
      blurb: 'Build a printable park-day schedule around dining and Lightning Lane times.',
    },
    {
      id: 'guides',
      label: 'Original guides',
      url: `${base}/guides`,
      blurb: 'Evergreen Florida & Disney planning guides by Gene Zentko.',
    },
  ];
}

function offerEmailHtml(offer) {
  if (!offer?.url) return '';
  return `
    <div style="margin:20px 0;padding:16px 18px;background:#f8f3e8;border-left:4px solid #ff6452;border-radius:4px;">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;color:#3f6b4f;font-weight:700;">${escapeHtml(offer.eyebrow)}</p>
      <p style="margin:0 0 12px;font-size:15px;color:#0e3b43;line-height:1.45;">${escapeHtml(offer.blurb)}</p>
      <p style="margin:0 0 10px;">
        <a href="${escapeHtml(offer.url)}" style="background:#0e3b43;color:#f8f3e8;padding:10px 16px;border-radius:3px;text-decoration:none;font-weight:700;font-size:14px;" target="_blank" rel="nofollow sponsored noopener">${escapeHtml(offer.cta)}</a>
      </p>
      <p style="margin:0;font-size:11px;color:#4a5350;line-height:1.4;">${escapeHtml(offer.disclosure || GENERIC_DISCLOSURE)}</p>
    </div>`;
}

function toolsEmailHtml(tools) {
  const rows = (tools || [])
    .map(
      (tool) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5ddc8;">
          <a href="${escapeHtml(tool.url)}" style="color:#0e3b43;font-weight:700;text-decoration:none;font-size:15px;">${escapeHtml(tool.label)}</a>
          <p style="margin:4px 0 0;font-size:13px;color:#4a5350;">${escapeHtml(tool.blurb)}</p>
        </td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

function newsletterMonetizationHtml(env = process.env, { siteUrl } = {}) {
  const tools = siteTools(siteUrl || env.SITE_URL);
  const offers = getActiveOffers(env, { placement: 'newsletter', limit: 2 });
  return `
    <div style="margin:28px 0 8px;padding-top:8px;border-top:1px solid #e5ddc8;">
      <p style="font-family:Georgia,serif;font-size:18px;color:#0e3b43;margin:0 0 8px;">Plan the trip with free tools</p>
      <p style="font-size:14px;color:#4a5350;margin:0 0 12px;">Skip the guesswork — use Florida Buzz wait times, the day planner, and guides while you map dates.</p>
      ${toolsEmailHtml(tools)}
      ${offers.map(offerEmailHtml).join('')}
    </div>`;
}

module.exports = {
  GENERIC_DISCLOSURE,
  OPTIONAL_OFFER_ENV,
  amazonAssociatesTag,
  amazonSearchUrl,
  getActiveOffers,
  getPrimaryOffer,
  siteTools,
  offerEmailHtml,
  toolsEmailHtml,
  newsletterMonetizationHtml,
  undercoverTouristUrl,
  undercoverTouristTrackedUrl,
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  escapeHtml,
};
