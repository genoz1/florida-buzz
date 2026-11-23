'use strict';

/**
 * Long-lived Instagram Login + Threads tokens expire (~60 days) and must be
 * refreshed while still valid. Unlike Pinterest, Meta uses the access token
 * itself as the refresh credential (no separate refresh_token).
 *
 * Flow:
 * 1. Prefer a newer token from Supabase `social_platform_tokens` when present
 * 2. Fall back to process.env
 * 3. Refresh via Meta before publish when the token is still accepted
 * 4. Persist the new token to Supabase so restarts/deploys keep working
 *
 * Once a token is fully expired, Meta rejects refresh — a human must mint a
 * new long-lived token in Meta Developer tools and update DigitalOcean env
 * (and/or the social_platform_tokens row).
 */

const PLATFORM_CONFIG = {
  instagram: {
    envToken: 'INSTAGRAM_ACCESS_TOKEN',
    refreshUrl: 'https://graph.instagram.com/refresh_access_token',
    grantType: 'ig_refresh_token',
  },
  threads: {
    envToken: 'THREADS_ACCESS_TOKEN',
    refreshUrl: 'https://graph.threads.net/refresh_access_token',
    grantType: 'th_refresh_token',
  },
};

const memory = {
  instagram: { token: null, expiresAt: 0 },
  threads: { token: null, expiresAt: 0 },
};

function resetMetaTokenCacheForTests() {
  memory.instagram = { token: null, expiresAt: 0 };
  memory.threads = { token: null, expiresAt: 0 };
}

function isAuthFailureMessage(detail = '') {
  return /oauthexception|invalid.?oauth|session.?has.?been.?invalidated|error.?validating.?access.?token|cannot.?parse.?access.?token|expired|access.?token.+expired|token.+invalid|code.?190|code.?102|permission.?denied/i.test(
    String(detail || '')
  );
}

function authRemediationHint(platform) {
  const envName = PLATFORM_CONFIG[platform]?.envToken || 'ACCESS_TOKEN';
  return (
    `${platform} access token is invalid or expired. ` +
    `Mint a new long-lived token in Meta Developer tools, set ${envName} in DigitalOcean, redeploy, ` +
    `then run scripts/test-${platform}.js (or wait for the next automate cycle).`
  );
}

async function readStoredToken(platform, { supabase } = {}) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('social_platform_tokens')
      .select('access_token, expires_at')
      .eq('platform', platform)
      .maybeSingle();
    if (error) {
      // Table may not exist yet — ignore so env tokens still work.
      if (!/social_platform_tokens|does not exist|42P01/i.test(error.message || '')) {
        console.warn(`[${platform}] token store read failed: ${error.message}`);
      }
      return null;
    }
    if (!data?.access_token) return null;
    return {
      token: data.access_token,
      expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
    };
  } catch (err) {
    console.warn(`[${platform}] token store read error: ${err.message}`);
    return null;
  }
}

async function writeStoredToken(platform, token, expiresAtMs, { supabase } = {}) {
  if (!supabase || !token) return false;
  try {
    const { error } = await supabase.from('social_platform_tokens').upsert(
      {
        platform,
        access_token: token,
        expires_at: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform' }
    );
    if (error) {
      if (!/social_platform_tokens|does not exist|42P01/i.test(error.message || '')) {
        console.warn(`[${platform}] token store write failed: ${error.message}`);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[${platform}] token store write error: ${err.message}`);
    return false;
  }
}

async function refreshLongLivedToken(platform, accessToken, { fetchImpl = fetch } = {}) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg || !accessToken) return null;
  const url = new URL(cfg.refreshUrl);
  url.searchParams.set('grant_type', cfg.grantType);
  url.searchParams.set('access_token', accessToken);
  const res = await fetchImpl(url.toString(), { method: 'GET' });
  const bodyText = await res.text();
  let data = {};
  try {
    data = JSON.parse(bodyText);
  } catch {
    data = { raw: bodyText };
  }
  if (!res.ok || !data.access_token) {
    const err = new Error(
      `${platform} token refresh failed: HTTP ${res.status} ${bodyText}`.slice(0, 400)
    );
    err.authFailure = isAuthFailureMessage(bodyText);
    throw err;
  }
  const expiresIn = Number(data.expires_in) || 60 * 24 * 3600;
  return {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 2 * 24 * 3600) * 1000, // refresh ~2 days early
  };
}

/**
 * Resolve a usable access token for Instagram or Threads.
 * Refreshes when memory/store expiry is near, and always tries a Meta refresh
 * at least once per cold process when only the env seed token is available.
 */
async function getMetaAccessToken(platform, {
  env = process.env,
  supabase = null,
  fetchImpl = fetch,
  forceRefresh = false,
} = {}) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) throw new Error(`Unknown Meta social platform: ${platform}`);

  const mem = memory[platform];
  if (!forceRefresh && mem.token && Date.now() < mem.expiresAt) {
    return mem.token;
  }

  const stored = await readStoredToken(platform, { supabase });
  const envToken = env[cfg.envToken] || null;
  let candidate = null;
  let candidateExpires = 0;

  if (stored?.token && (!envToken || (stored.expiresAt || 0) > Date.now())) {
    candidate = stored.token;
    candidateExpires = stored.expiresAt || 0;
  } else if (envToken) {
    candidate = envToken;
    candidateExpires = 0;
  } else if (stored?.token) {
    candidate = stored.token;
    candidateExpires = stored.expiresAt || 0;
  }

  if (!candidate) return null;

  const needsRefresh = forceRefresh
    || !candidateExpires
    || Date.now() >= candidateExpires
    || (candidateExpires - Date.now()) < 3 * 24 * 60 * 60 * 1000; // < 3 days left

  if (needsRefresh) {
    try {
      const refreshed = await refreshLongLivedToken(platform, candidate, { fetchImpl });
      mem.token = refreshed.token;
      mem.expiresAt = refreshed.expiresAt;
      await writeStoredToken(platform, refreshed.token, refreshed.expiresAt, { supabase });
      console.log(`[${platform}] long-lived access token refreshed (expires ~${new Date(refreshed.expiresAt).toISOString()})`);
      return refreshed.token;
    } catch (err) {
      console.warn(`[${platform}] ${err.message}`);
      if (err.authFailure || isAuthFailureMessage(err.message)) {
        // Env/store token is dead — surface null so callers fail with remediation.
        if (!candidateExpires || Date.now() >= candidateExpires) {
          return null;
        }
      }
      // Transient refresh failure with a still-fresh stored token — keep using it.
      if (candidateExpires && Date.now() < candidateExpires) {
        mem.token = candidate;
        mem.expiresAt = candidateExpires;
        return candidate;
      }
    }
  }

  mem.token = candidate;
  mem.expiresAt = candidateExpires || Date.now() + 6 * 60 * 60 * 1000;
  return candidate;
}

module.exports = {
  PLATFORM_CONFIG,
  authRemediationHint,
  getMetaAccessToken,
  isAuthFailureMessage,
  refreshLongLivedToken,
  resetMetaTokenCacheForTests,
};
