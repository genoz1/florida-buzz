'use strict';

/**
 * Florida Buzz Merch — Shopify storefront bridge (brand-first).
 *
 * Browse experience lives on thefloridabuzz.com/merch.
 * Checkout / variants / payment live on Shopify.
 *
 * Config:
 *   content/merch-products.json — storeUrl + optional manual product overrides
 *   MERCH_STORE_URL / SHOPIFY_STORE_URL — storefront base (e.g. https://40tfyd-gr.myshopify.com)
 *
 * When the store looks like Shopify, products are live-synced from /products.json
 * (cached) so new drops appear without redeploying. Manual JSON products win if set.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'content', 'merch-products.json');
const SHOPIFY_CACHE_MS = Number(process.env.MERCH_SHOPIFY_CACHE_MS || 10 * 60 * 1000);

/** Prefer these handles/titles first on the Florida Buzz merch page. */
const FEATURED_TITLE_RE = [
  /i caught a buzz in florida/i,
  /i caught my buzz in florida/i,
  /i got my buzz from the florida buzz/i,
  /florida buzzed since/i,
];

let shopifyCache = { key: null, fetchedAt: 0, products: null };

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

function storeOrigin(storeUrl) {
  const url = trimUrl(storeUrl);
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isPlaceholderUrl(url) {
  if (!url) return true;
  return /YOUR-STORE|YOUR-PRODUCT|example\.com|myshopify\.com\/products\/YOUR/i.test(url);
}

function detectProvider(storeUrl, explicit) {
  const raw = String(explicit || '').trim().toLowerCase();
  if (raw === 'shopify' || raw === 'printify') return raw;
  const host = String(storeUrl || '').toLowerCase();
  if (/myshopify\.com|shopify\.com/i.test(host)) return 'shopify';
  if (/printify\.me|printify\.com/i.test(host)) return 'printify';
  return 'shopify';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortDescription(title, bodyHtml) {
  const cleaned = stripHtml(bodyHtml);
  if (/caught a buzz|caught my buzz|got my buzz from the florida buzz/i.test(title)) {
    return 'The soon-to-be-famous Florida Buzz tee. Soft Comfort Colors fit — pick size and color at checkout.';
  }
  if (/mug/i.test(title)) {
    return 'Official Florida Buzz mug energy for coffee before rope drop. Pick size at checkout.';
  }
  // Avoid dumping Printify template boilerplate onto the brand page.
  if (/Comfort Colors introduces|Warm-up with a nice cuppa|fully customizable tee/i.test(cleaned)) {
    return 'Official Florida Buzz merch. Choose size and color at checkout.';
  }
  if (cleaned.length > 40 && cleaned.length < 220) return cleaned;
  return 'Official Florida Buzz merch. Choose size and color at checkout.';
}

function featureRank(title) {
  const t = String(title || '');
  for (let i = 0; i < FEATURED_TITLE_RE.length; i += 1) {
    if (FEATURED_TITLE_RE[i].test(t)) return i;
  }
  return FEATURED_TITLE_RE.length + 1;
}

function normalizeProduct(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.name || '').trim();
  const url = trimUrl(raw.url || raw.href || raw.productUrl);
  if (!title || !url || isPlaceholderUrl(url)) return null;
  if (/^Replace with/i.test(title)) return null;
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
    throw new Error('MERCH_PRODUCTS / PRINTIFY_PRODUCTS must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('MERCH_PRODUCTS / PRINTIFY_PRODUCTS must be a JSON array');
  return parsed.map(normalizeProduct).filter(Boolean);
}

function loadCatalogFile(filePath = DEFAULT_CATALOG_PATH) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { storeUrl: null, storeName: null, provider: null, products: [] };
    }
    const list = Array.isArray(parsed.products) ? parsed.products : [];
    return {
      storeUrl: trimUrl(parsed.storeUrl),
      storeName: String(parsed.storeName || '').trim() || null,
      provider: String(parsed.provider || '').trim().toLowerCase() || null,
      products: list.map(normalizeProduct).filter(Boolean),
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { storeUrl: null, storeName: null, provider: null, products: [] };
    }
    console.warn('[merch] catalog file skipped:', err.message);
    return { storeUrl: null, storeName: null, provider: null, products: [] };
  }
}

function shopifyProductToCard(product, origin) {
  const handle = String(product.handle || '').trim();
  if (!handle) return null;
  const title = String(product.title || '').trim();
  if (!title) return null;
  const images = Array.isArray(product.images) ? product.images : [];
  const imageUrl = trimUrl(images[0]?.src);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const prices = variants
    .map((v) => Number.parseFloat(v.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  let price = null;
  if (prices.length === 1) price = `$${prices[0].toFixed(0)}`;
  else if (prices.length > 1) price = `From $${prices[0].toFixed(0)}`;

  return normalizeProduct({
    id: String(product.id || handle),
    title,
    url: `${origin}/products/${handle}`,
    imageUrl,
    price,
    description: shortDescription(title, product.body_html),
  });
}

async function fetchShopifyProducts(storeUrl, { fetcher = fetch, now = Date.now() } = {}) {
  const origin = storeOrigin(storeUrl);
  if (!origin) return [];
  if (
    shopifyCache.key === origin &&
    shopifyCache.products &&
    now - shopifyCache.fetchedAt < SHOPIFY_CACHE_MS
  ) {
    return shopifyCache.products;
  }

  const endpoint = `${origin}/products.json?limit=50`;
  const response = await fetcher(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`Shopify products.json ${response.status}`);
  }
  const data = await response.json();
  const list = Array.isArray(data.products) ? data.products : [];
  const products = list
    .map((p) => shopifyProductToCard(p, origin))
    .filter(Boolean)
    .sort((a, b) => {
      const rankDiff = featureRank(a.title) - featureRank(b.title);
      if (rankDiff !== 0) return rankDiff;
      return a.title.localeCompare(b.title);
    });

  shopifyCache = { key: origin, fetchedAt: now, products };
  return products;
}

function clearShopifyCache() {
  shopifyCache = { key: null, fetchedAt: 0, products: null };
}

function resolveStoreUrl(env = process.env, file = {}) {
  return (
    trimUrl(env.MERCH_STORE_URL) ||
    trimUrl(env.SHOPIFY_STORE_URL) ||
    trimUrl(env.PRINTIFY_STORE_URL) ||
    file.storeUrl ||
    null
  );
}

function merchConfig(env = process.env, { catalogPath = DEFAULT_CATALOG_PATH, products } = {}) {
  const file = loadCatalogFile(catalogPath);
  let list = Array.isArray(products) ? products : file.products;

  const productsEnv = env.MERCH_PRODUCTS || env.PRINTIFY_PRODUCTS;
  if (!products && productsEnv) {
    try {
      const fromEnv = parseProductsJson(productsEnv);
      if (fromEnv.length) list = fromEnv;
    } catch (err) {
      console.warn('[merch]', err.message);
    }
  }

  const storeUrl = resolveStoreUrl(env, file);
  const storeName =
    String(
      env.MERCH_STORE_NAME ||
        env.SHOPIFY_STORE_NAME ||
        env.PRINTIFY_STORE_NAME ||
        file.storeName ||
        'Florida Buzz Merch'
    ).trim() || 'Florida Buzz Merch';
  const provider = detectProvider(storeUrl, env.MERCH_PROVIDER || file.provider);
  const enabled = Boolean(storeUrl || list.length);

  return {
    enabled,
    storeUrl,
    products: list,
    storeName,
    provider,
    checkoutLabel: 'Get yours',
    browseLabel: 'Browse all merch',
    storefrontLabel: 'Florida Buzz store',
  };
}

/**
 * Preferred entry for the /merch route — live-syncs Shopify when possible.
 */
async function merchConfigAsync(env = process.env, opts = {}) {
  const base = merchConfig(env, opts);
  const forceFileOnly = String(env.MERCH_USE_FILE_ONLY || '').toLowerCase() === 'true';
  if (forceFileOnly || base.provider !== 'shopify' || !base.storeUrl) return base;

  // Manual catalog products (non-placeholder) win over live sync.
  if (base.products.length) return base;

  try {
    const live = await fetchShopifyProducts(base.storeUrl, {
      fetcher: opts.fetcher,
      now: opts.now,
    });
    if (live.length) {
      return { ...base, products: live, enabled: true };
    }
  } catch (err) {
    console.warn('[merch] Shopify sync failed:', err.message);
  }
  return base;
}

module.exports = {
  merchConfig,
  merchConfigAsync,
  parseProductsJson,
  normalizeProduct,
  trimUrl,
  loadCatalogFile,
  detectProvider,
  fetchShopifyProducts,
  clearShopifyCache,
  storeOrigin,
  shortDescription,
  featureRank,
  DEFAULT_CATALOG_PATH,
};
