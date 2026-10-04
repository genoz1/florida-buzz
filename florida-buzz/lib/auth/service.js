class AuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError('invalid_auth_input');
  }
  return email;
}

function normalizeDisplayName(value) {
  const displayName = typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
  if (displayName.length < 2 || displayName.length > 40 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new AuthError('invalid_auth_input');
  }
  return displayName;
}

function normalizeOtp(value) {
  const otp = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{6}$/.test(otp)) throw new AuthError('invalid_otp');
  return otp;
}

function safeProfile(profile) {
  return {
    id: profile.user_id || profile.userId,
    displayName: profile.display_name || profile.displayName,
    role: profile.role,
    status: profile.status,
  };
}

function createAuthService({ store, provider, limiter, verifyTurnstile, config, now = () => new Date() }) {
  async function consumeLimit(namespace, identifier, limit, windowSeconds) {
    const result = await limiter.consume(namespace, identifier, limit, windowSeconds);
    if (!result.allowed) {
      const error = new AuthError('rate_limited', 429);
      error.retryAfterSeconds = result.retryAfterSeconds;
      throw error;
    }
  }

  return {
    async requestOtp(input, context = {}) {
      const email = normalizeEmail(input?.email);
      const displayName = normalizeDisplayName(input?.displayName);
      const newsletterOptIn = input?.newsletterOptIn === true;
      await consumeLimit('otp-ip', context.ip || 'unknown', 5, 15 * 60);
      await consumeLimit('otp-email', email, 3, 15 * 60);
      const turnstile = await verifyTurnstile(input?.turnstileToken, context.ip);
      if (!turnstile.ok) throw new AuthError('turnstile_rejected', 400);

      const challenge = await store.createChallenge({
        email,
        displayName,
        newsletterOptIn,
        ttlSeconds: config.challengeTtlSeconds,
      });
      try {
        await provider.requestOtp(email);
      } catch {
        await store.consumeChallenge(challenge.challengeId);
        throw new AuthError('auth_provider_unavailable', 503);
      }
      return {
        challengeId: challenge.challengeId,
        expiresInSeconds: config.challengeTtlSeconds,
      };
    },

    async verifyOtp(input, context = {}) {
      const challengeId = typeof input?.challengeId === 'string' ? input.challengeId : '';
      const otp = normalizeOtp(input?.otp);
      if (!challengeId || challengeId.length > 200) throw new AuthError('invalid_otp');
      await consumeLimit('verify-ip', context.ip || 'unknown', 10, 15 * 60);
      await consumeLimit('verify-challenge', challengeId, 5, 15 * 60);

      const challenge = await store.getChallenge(challengeId);
      const expired = !challenge || challenge.consumedAt || new Date(challenge.expiresAt) <= now();
      if (expired || challenge.otpAttempts >= 5) throw new AuthError('invalid_otp');

      const verified = await provider.verifyOtp(challenge.email, otp);
      if (!verified) {
        await store.incrementChallengeAttempts(challengeId, challenge.otpAttempts + 1);
        throw new AuthError('invalid_otp');
      }
      const verifiedEmail = typeof verified.user?.email === 'string'
        ? verified.user.email.trim().toLowerCase()
        : '';
      if (!verified.user?.id || verifiedEmail !== challenge.email) {
        await store.consumeChallenge(challengeId);
        throw new AuthError('identity_mismatch', 403);
      }

      const session = verified.session;
      if (!session.access_token || !session.refresh_token) throw new AuthError('auth_provider_unavailable', 503);
      const profile = await store.upsertProfile(verified.user.id, challenge.displayName);
      if (!profile || profile.status !== 'active') {
        await store.consumeChallenge(challengeId);
        throw new AuthError('account_unavailable', 403);
      }
      if (challenge.newsletterOptIn) await store.subscribeWithConsent(challenge.email);

      const accessTokenExpiresAt = new Date((session.expires_at || Math.floor(now().getTime() / 1000) + 3600) * 1000);
      const storedSession = await store.createSession({
        userId: verified.user.id,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        accessTokenExpiresAt,
        idleSeconds: config.sessionIdleSeconds,
        absoluteSeconds: config.sessionAbsoluteSeconds,
      });
      await store.consumeChallenge(challengeId);
      return { sessionId: storedSession.sessionId, user: safeProfile(profile) };
    },

    async authenticate(sessionId) {
      if (!sessionId) throw new AuthError('authentication_required', 401);
      const session = await store.getSession(sessionId);
      if (!session || session.revokedAt) throw new AuthError('authentication_required', 401);
      const absoluteExpiresAt = new Date(session.absoluteExpiresAt);
      const idleExpiresAt = new Date(session.idleExpiresAt);
      if (absoluteExpiresAt <= now() || idleExpiresAt <= now()) {
        await store.revokeSession(sessionId);
        throw new AuthError('session_expired', 401);
      }

      let tokens = session.tokens;
      let accessTokenExpiresAt = new Date(session.accessTokenExpiresAt);
      if (accessTokenExpiresAt.getTime() - now().getTime() < 60 * 1000) {
        const refreshed = await provider.refreshSession(tokens.refreshToken);
        if (!refreshed?.session?.access_token || !refreshed.session.refresh_token) {
          await store.revokeSession(sessionId);
          throw new AuthError('session_expired', 401);
        }
        tokens = {
          accessToken: refreshed.session.access_token,
          refreshToken: refreshed.session.refresh_token,
        };
        accessTokenExpiresAt = new Date((refreshed.session.expires_at || Math.floor(now().getTime() / 1000) + 3600) * 1000);
      }

      const profile = await store.getProfile(session.userId);
      if (!profile || profile.status !== 'active') {
        await store.revokeSession(sessionId);
        throw new AuthError('account_unavailable', 403);
      }
      const nextIdle = new Date(Math.min(
        now().getTime() + config.sessionIdleSeconds * 1000,
        absoluteExpiresAt.getTime()
      ));
      await store.updateSession(sessionId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresAt,
        idleExpiresAt: nextIdle,
      });
      return { sessionId, user: safeProfile(profile) };
    },

    async logout(sessionId) {
      if (sessionId) await store.revokeSession(sessionId);
    },
  };
}

module.exports = {
  AuthError,
  createAuthService,
  normalizeDisplayName,
  normalizeEmail,
  normalizeOtp,
  safeProfile,
};
