'use strict';

/**
 * Florida Buzz Merch — Printify Pop-Up Store bridge.
 *
 * Colors, sizes, prices, and checkout live on Printify. This site only
 * shows a couple of product cards and deep-links into the Pop-Up Store.
 *
 * Primary config: content/merch-products.json
 *   { "storeUrl": "https://your-store.printify.me", "products": [
 *       { "title", "url", "imageUrl?", "description?" }
 *   ] }
 *
 * Optional env overrides:
 *   PRINTIFY_STORE_URL — overrides JSON storeUrl
 *   PRINTIFY_PRODUCTS  — JSON array override (rare; prefer the file)
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'content', 'merch-products.json');

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

function isPlaceholderUrl(url) {
  if (!url) return true;
  return /YOUR-STORE|YOUR-PRODUCT|example\.com/i.test(url);
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
    throw new Error('PRINTIFY_PRODUCTS must be valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('PRINTIFY_PRODUCTS must be a JSON array');
  return parsed.map(normalizeProduct).filter(Boolean);
}

function loadCatalogFile(filePath = DEFAULT_CATALOG_PATH) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { storeUrl: null, storeName: null, products: [] };
    }
    const list = Array.isArray(parsed.products) ? parsed.products : [];
    return {
      storeUrl: trimUrl(parsed.storeUrl),
      storeName: String(parsed.storeName || '').trim() || null,
      products: list.map(normalizeProduct).filter(Boolean),
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { storeUrl: null, storeName: null, products: [] };
    }
    console.warn('[merch] catalog file skipped:', err.message);
    return { storeUrl: null, storeName: null, products: [] };
  }
}

function merchConfig(env = process.env, { catalogPath = DEFAULT_CATALOG_PATH } = {}) {
  const file = loadCatalogFile(catalogPath);
  let products = file.products;

  // Env product list is an escape hatch; the JSON file is the normal path.
  if (env.PRINTIFY_PRODUCTS) {
    try {
      const fromEnv = parseProductsJson(env.PRINTIFY_PRODUCTS);
      if (fromEnv.length) products = fromEnv;
    } catch (err) {
      console.warn('[merch]', err.message);
    }
  }

  const storeUrl = trimUrl(env.PRINTIFY_STORE_URL) || file.storeUrl;
  const enabled = Boolean(storeUrl || products.length);
  return {
    enabled,
    storeUrl,
    products,
    storeName: String(env.PRINTIFY_STORE_NAME || file.storeName || 'Florida Buzz Merch').trim() || 'Florida Buzz Merch',
  };
}

module.exports = {
  merchConfig,
  parseProductsJson,
  normalizeProduct,
  trimUrl,
  loadCatalogFile,
  DEFAULT_CATALOG_PATH,
};
