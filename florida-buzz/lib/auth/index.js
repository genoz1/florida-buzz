const { getAuthConfig, validateAuthConfig } = require('./config');
const { createCsrfProtection } = require('./csrf');
const { createAuthMiddleware } = require('./middleware');
const { createSupabaseOtpProvider } = require('./provider');
const { createSupabaseRateLimiter } = require('./rateLimit');
const { createAuthRouter } = require('./router');
const { createAuthService } = require('./service');
const { createSupabaseAuthStore } = require('./store');
const { createTurnstileVerifier } = require('./turnstile');

function startAuthCleanup(store, {
  batchSize = 500,
  intervalMs = 6 * 60 * 60 * 1000,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  queueMicrotaskFn = queueMicrotask,
} = {}) {
  let running = false;
  async function run() {
    if (running) return;
    running = true;
    try {
      await store.cleanupExpired(batchSize);
    } catch {
      logger.warn('Authentication retention cleanup failed.');
    } finally {
      running = false;
    }
  }

  queueMicrotaskFn(run);
  const timer = setIntervalFn(run, intervalMs);
  timer.unref?.();
  return { run, stop: () => clearIntervalFn(timer) };
}

function createProductionAuthFoundation(env = process.env) {
  const config = getAuthConfig(env);
  if (!config.readerAuthEnabled) throw new Error('Reader authentication is disabled.');
  const { supabase: serviceClient } = require('../supabase');
  validateAuthConfig(config, { serviceClient });

  const store = createSupabaseAuthStore({ client: serviceClient, encryptionKey: config.encryptionKey });
  startAuthCleanup(store);
  const provider = createSupabaseOtpProvider({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey });
  const limiter = createSupabaseRateLimiter({ client: serviceClient, key: config.rateLimitKey });
  const verifyTurnstile = createTurnstileVerifier({
    mode: config.turnstileMode,
    secret: config.turnstileSecret,
    production: config.production,
  });
  const csrf = createCsrfProtection({
    key: config.csrfKey,
    cookieName: config.csrfCookieName,
    secure: config.secureCookies,
    ttlSeconds: config.csrfTtlSeconds,
  });
  const service = createAuthService({ store, provider, limiter, verifyTurnstile, config });
  const authMiddleware = createAuthMiddleware({ service, config });
  return { authMiddleware, config, csrf, limiter, service, store };
}

function createProductionAuthRouter(env = process.env) {
  return createAuthRouter(createProductionAuthFoundation(env));
}

module.exports = {
  createAuthMiddleware,
  createAuthRouter,
  createAuthService,
  createCsrfProtection,
  createProductionAuthFoundation,
  createProductionAuthRouter,
  createSupabaseAuthStore,
  createSupabaseOtpProvider,
  createSupabaseRateLimiter,
  createTurnstileVerifier,
  getAuthConfig,
  startAuthCleanup,
  validateAuthConfig,
};
