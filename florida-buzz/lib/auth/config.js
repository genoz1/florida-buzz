const crypto = require('crypto');

const DEFAULTS = {
  challengeTtlSeconds: 10 * 60,
  sessionIdleSeconds: 24 * 60 * 60,
  sessionAbsoluteSeconds: 7 * 24 * 60 * 60,
  csrfTtlSeconds: 30 * 60,
};

function enabled(value) {
  return value === true || value === 'true';
}

function decodeSecurityKey(value) {
  if (!value || typeof value !== 'string') return null;
  const key = Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

function deriveKey(securityKey, purpose) {
  return crypto.createHmac('sha256', securityKey).update(`florida-buzz:${purpose}:v1`).digest();
}

function getAuthConfig(env = process.env) {
  const runtimeMode = env.AUTH_RUNTIME_MODE || (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : '');
  const production = runtimeMode === 'production';
  const securityKey = decodeSecurityKey(env.AUTH_SECURITY_KEY);
  const readerAuthEnabled = enabled(env.READER_AUTH_ENABLED);
  const turnstileMode = env.TURNSTILE_MODE || (env.TURNSTILE_SECRET_KEY ? 'verify' : 'disabled');

  return {
    production,
    runtimeMode,
    readerAuthEnabled,
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    securityKey,
    encryptionKey: securityKey ? deriveKey(securityKey, 'session-encryption') : null,
    csrfKey: securityKey ? deriveKey(securityKey, 'csrf') : null,
    rateLimitKey: securityKey ? deriveKey(securityKey, 'rate-limit') : null,
    turnstileMode,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || '',
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || '',
    sessionCookieName: production ? '__Host-fb_session' : 'fb_session',
    csrfCookieName: production ? '__Host-fb_csrf' : 'fb_csrf',
    secureCookies: production,
    ...DEFAULTS,
  };
}

function validateAuthConfig(config, { serviceClient } = {}) {
  if (!config.readerAuthEnabled) return;
  const missing = [];
  if (!['local', 'test', 'production'].includes(config.runtimeMode)) {
    missing.push('AUTH_RUNTIME_MODE (local, test, or production)');
  }
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.securityKey) missing.push('AUTH_SECURITY_KEY (32 random bytes, base64 encoded)');
  if (!serviceClient) missing.push('SUPABASE_SERVICE_KEY/server service client');
  if (config.production && (config.turnstileMode !== 'verify' || !config.turnstileSecret)) {
    missing.push('TURNSTILE_SECRET_KEY with TURNSTILE_MODE=verify');
  }
  if (config.production && config.turnstileMode === 'disabled') {
    missing.push('Turnstile cannot be disabled in production');
  }
  if (missing.length) {
    throw new Error(`Reader authentication is enabled but required private configuration is missing: ${missing.join(', ')}`);
  }
}

module.exports = { DEFAULTS, decodeSecurityKey, deriveKey, enabled, getAuthConfig, validateAuthConfig };
