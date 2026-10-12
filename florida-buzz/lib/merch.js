'use strict';

/**
 * Florida Buzz Merch — Printify Pop-Up Store bridge.
 *
 * Checkout, payment, print, and ship stay on Printify. This site only
 * showcases products and deep-links into the Pop-Up Store.
 *
 * Env:
 *   PRINTIFY_STORE_URL          — https://your-store.printify.me (required to enable shop CTAs)
 *   PRINTIFY_PRODUCTS           — JSON array of { title, url, imageUrl?, price?, description? }
 *   PRINTIFY_FEATURED_TITLE     — single-shirt shortcuts when PRODUCTS is unset
 *   PRINTIFY_FEATURED_URL
 *   PRINTIFY_FEATURED_IMAGE_URL
 *   PRINTIFY_FEATURED_PRICE
 *   PRINTIFY_FEATURED_DESCRIPTION
 */

function trimUrl(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeProduct(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.name || '').trim();
  const url = trimUrl(raw.url || raw.href || raw.productUrl);
  if (!title || !url) return null;
  const imageUrl = trimUrl(raw.imageUrl || raw.image || raw.image_url);
  const price = String(raw.price || '').trim() || null;
  const description = String(raw.description || raw.dek || '').trim() || null;
  return {
    id: String(raw.id || `product-${index + 1}`),
    title,
    url,
    imageUrl,
    price,
    description,
  };
}

function parseProductsJson(raw) {
  if (!raw || !String(raw).trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error('PRINTIFY_PRODUCTS must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('PRINTIFY_PRODUCTS must be a JSON array');
  return parsed.map(normalizeProduct).filter(Boolean);
}

function featuredFromEnv(env) {
  const title = String(env.PRINTIFY_FEATURED_TITLE || '').trim();
  const url = trimUrl(env.PRINTIFY_FEATURED_URL);
  if (!title || !url) return null;
  return normalizeProduct(
    {
      id: 'featured',
      title,
      url,
      imageUrl: env.PRINTIFY_FEATURED_IMAGE_URL,
      price: env.PRINTIFY_FEATURED_PRICE,
      description: env.PRINTIFY_FEATURED_DESCRIPTION,
    },
    0
  );
}

function merchConfig(env = process.env) {
  const storeUrl = trimUrl(env.PRINTIFY_STORE_URL);
  let products = [];
  try {
    products = parseProductsJson(env.PRINTIFY_PRODUCTS);
  } catch (err) {
    console.warn('[merch]', err.message);
    products = [];
  }
  if (!products.length) {
    const featured = featuredFromEnv(env);
    if (featured) products = [featured];
  }
  // If only a store URL is set, still enable the page with a store-wide CTA.
  const enabled = Boolean(storeUrl || products.length);
  return {
    enabled,
    storeUrl,
    products,
    storeName: String(env.PRINTIFY_STORE_NAME || 'Florida Buzz Merch').trim() || 'Florida Buzz Merch',
  };
}

module.exports = {
  merchConfig,
  parseProductsJson,
  normalizeProduct,
  trimUrl,
  featuredFromEnv,
};
