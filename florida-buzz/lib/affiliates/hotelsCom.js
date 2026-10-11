'use strict';

/**
 * Hotels.com affiliate helper.
 *
 * Set HOTELS_COM_URL to your full tracked affiliate URL (required to show CTAs).
 * Optional destination overrides:
 *   HOTELS_COM_URL_DISNEY
 *   HOTELS_COM_URL_UNIVERSAL
 *   HOTELS_COM_URL_PORT_CANAVERAL
 *
 * Site redirects (/go/hotels, /go/hotels/:dest) resolve through these so guide
 * HTML can stay stable when the affiliate URL rotates.
 */

const PARTNER_NAME = 'Hotels.com';
const AFFILIATE_DISCLOSURE_SHORT =
  'Hotels.com is an affiliate partner. If you book through our link, we may earn a commission at no extra cost to you.';

const DESTINATIONS = {
  disney: {
    envKey: 'HOTELS_COM_URL_DISNEY',
    label: 'hotels near Disney World',
    searchHint: 'Walt Disney World Resort, FL',
  },
  universal: {
    envKey: 'HOTELS_COM_URL_UNIVERSAL',
    label: 'hotels near Universal Orlando',
    searchHint: 'Universal Orlando Resort, FL',
  },
  'port-canaveral': {
    envKey: 'HOTELS_COM_URL_PORT_CANAVERAL',
    label: 'hotels near Port Canaveral',
    searchHint: 'Port Canaveral, FL',
  },
  orlando: {
    envKey: 'HOTELS_COM_URL_ORLANDO',
    label: 'Orlando hotels',
    searchHint: 'Orlando, FL',
  },
};

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function hotelsComBaseUrl(env = process.env) {
  const url = String(env.HOTELS_COM_URL || '').trim();
  return isHttpUrl(url) ? url : null;
}

function hotelsComConfigured(env = process.env) {
  return Boolean(hotelsComBaseUrl(env));
}

/**
 * Resolve the outbound Hotels.com affiliate URL for a destination key.
 * Falls back to HOTELS_COM_URL when a destination-specific override is unset.
 */
function hotelsComUrl(env = process.env, dest = null) {
  const key = String(dest || '').trim().toLowerCase();
  if (key && DESTINATIONS[key]) {
    const override = String(env[DESTINATIONS[key].envKey] || '').trim();
    if (isHttpUrl(override)) return override;
  }
  return hotelsComBaseUrl(env);
}

function hotelsComSitePath(dest = null, siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com') {
  const base = String(siteUrl || 'https://thefloridabuzz.com').replace(/\/$/, '');
  const key = String(dest || '').trim().toLowerCase();
  if (key && DESTINATIONS[key]) return `${base}/go/hotels/${encodeURIComponent(key)}`;
  return `${base}/go/hotels`;
}

function normalizeHotelsDest(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (!key) return null;
  if (DESTINATIONS[key]) return key;
  if (key === 'disney-world' || key === 'wdw') return 'disney';
  if (key === 'universal-orlando' || key === 'uo') return 'universal';
  if (key === 'canaveral' || key === 'cruise') return 'port-canaveral';
  return null;
}

module.exports = {
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  DESTINATIONS,
  hotelsComBaseUrl,
  hotelsComConfigured,
  hotelsComUrl,
  hotelsComSitePath,
  normalizeHotelsDest,
  isHttpUrl,
};
