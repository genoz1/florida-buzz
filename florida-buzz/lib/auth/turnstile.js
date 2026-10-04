function createTurnstileVerifier({ mode, secret, production, fetchImpl = global.fetch, timeoutMs = 5000 }) {
  return async function verifyTurnstile(token, remoteIp) {
    if (mode === 'disabled') {
      if (production) return { ok: false, reason: 'turnstile_not_configured' };
      return { ok: true, mode: 'disabled-local-test' };
    }
    if (mode !== 'verify' || !secret || !token || typeof fetchImpl !== 'function') {
      return { ok: false, reason: 'turnstile_not_configured' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, reason: 'turnstile_unavailable' };
      const result = await response.json();
      return result.success === true
        ? { ok: true, mode: 'verified' }
        : { ok: false, reason: 'turnstile_rejected', codes: result['error-codes'] || [] };
    } catch {
      return { ok: false, reason: 'turnstile_unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  };
}

module.exports = { createTurnstileVerifier };
