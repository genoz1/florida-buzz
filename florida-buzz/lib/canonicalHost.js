'use strict';

/**
 * Permanent apex-host redirect: www.thefloridabuzz.com → https://thefloridabuzz.com
 * Preserves path + query string in a single 301 hop.
 */
function createCanonicalHostRedirect({
  apexHost = 'thefloridabuzz.com',
  wwwHost = 'www.thefloridabuzz.com',
  enabled = true,
} = {}) {
  return function canonicalHostRedirect(req, res, next) {
    if (!enabled) return next();
    const host = String(req.hostname || '')
      .toLowerCase()
      .replace(/:\d+$/, '');
    if (host !== wwwHost) return next();
    const path = req.originalUrl || req.url || '/';
    const target = `https://${apexHost}${path.startsWith('/') ? path : `/${path}`}`;
    res.set('Cache-Control', 'public, max-age=3600');
    return res.redirect(301, target);
  };
}

module.exports = { createCanonicalHostRedirect };
