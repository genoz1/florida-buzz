const { keyedHash } = require('./crypto');

function createSupabaseRateLimiter({ client, key }) {
  if (!client || !key) throw new Error('Rate limiter requires a service client and private key.');
  return {
    async consume(namespace, identifier, limit, windowSeconds) {
      const bucketKey = keyedHash(key, `${namespace}:${identifier || 'unknown'}`);
      const { data, error } = await client.rpc('consume_auth_rate_limit', {
        p_bucket_key: bucketKey,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new Error('Rate-limit storage unavailable.');
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error('Rate-limit storage returned no result.');
      return {
        allowed: row.allowed === true,
        remaining: Number(row.remaining || 0),
        retryAfterSeconds: Number(row.retry_after_seconds || 0),
      };
    },
  };
}

function createRateLimitMiddleware({ limiter, namespace, limit, windowSeconds, identify }) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const result = await limiter.consume(namespace, identify(req), limit, windowSeconds);
      res.set('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
      if (!result.allowed) {
        if (result.retryAfterSeconds) res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).json({ error: 'rate_limited' });
      }
      next();
    } catch {
      return res.status(503).json({ error: 'security_service_unavailable' });
    }
  };
}

module.exports = { createRateLimitMiddleware, createSupabaseRateLimiter };
