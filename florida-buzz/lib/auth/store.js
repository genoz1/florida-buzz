const { decryptJson, encryptJson, randomToken, sha256 } = require('./crypto');

function throwOnError(error, message) {
  if (error) throw new Error(message);
}

function createSupabaseAuthStore({ client, encryptionKey, now = () => new Date() }) {
  if (!client || !encryptionKey) throw new Error('Auth store requires a service client and encryption key.');

  return {
    async createChallenge({ email, displayName, newsletterOptIn, ttlSeconds }) {
      const challengeId = randomToken();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
      const { error } = await client.from('auth_challenges').insert({
        challenge_hash: sha256(challengeId),
        email_ciphertext: encryptJson(encryptionKey, { email }),
        display_name: displayName,
        newsletter_opt_in: newsletterOptIn === true,
        otp_attempts: 0,
        expires_at: expiresAt.toISOString(),
        created_at: createdAt.toISOString(),
      });
      throwOnError(error, 'Could not create authentication challenge.');
      return { challengeId, expiresAt };
    },

    async getChallenge(challengeId) {
      const { data, error } = await client
        .from('auth_challenges')
        .select('challenge_hash, email_ciphertext, display_name, newsletter_opt_in, otp_attempts, expires_at, consumed_at')
        .eq('challenge_hash', sha256(challengeId))
        .maybeSingle();
      throwOnError(error, 'Could not read authentication challenge.');
      if (!data) return null;
      const { email } = decryptJson(encryptionKey, data.email_ciphertext);
      return {
        email,
        displayName: data.display_name,
        newsletterOptIn: data.newsletter_opt_in === true,
        otpAttempts: Number(data.otp_attempts || 0),
        expiresAt: data.expires_at,
        consumedAt: data.consumed_at,
      };
    },

    async incrementChallengeAttempts(challengeId, attempts) {
      const { error } = await client
        .from('auth_challenges')
        .update({ otp_attempts: attempts })
        .eq('challenge_hash', sha256(challengeId));
      throwOnError(error, 'Could not update authentication challenge.');
    },

    async consumeChallenge(challengeId) {
      const { error } = await client
        .from('auth_challenges')
        .update({ consumed_at: now().toISOString() })
        .eq('challenge_hash', sha256(challengeId));
      throwOnError(error, 'Could not consume authentication challenge.');
    },

    async upsertProfile(userId, displayName) {
      const timestamp = now().toISOString();
      const existing = await this.getProfile(userId);
      if (existing) {
        const { error } = await client.from('profiles')
          .update({ display_name: displayName, updated_at: timestamp })
          .eq('user_id', userId);
        throwOnError(error, 'Could not update reader profile.');
      } else {
        const { error } = await client.from('profiles').insert({
          user_id: userId,
          display_name: displayName,
          updated_at: timestamp,
        });
        if (error?.code === '23505') {
          const retry = await client.from('profiles')
            .update({ display_name: displayName, updated_at: timestamp })
            .eq('user_id', userId);
          throwOnError(retry.error, 'Could not update reader profile.');
        } else {
          throwOnError(error, 'Could not create reader profile.');
        }
      }
      return this.getProfile(userId);
    },

    async getProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('user_id, display_name, role, status')
        .eq('user_id', userId)
        .maybeSingle();
      throwOnError(error, 'Could not read reader profile.');
      return data || null;
    },

    async subscribeWithConsent(email) {
      const { error } = await client.from('subscribers').upsert(
        { email, active: true },
        { onConflict: 'email' }
      );
      throwOnError(error, 'Could not save explicit newsletter consent.');
    },

    async createSession({ userId, accessToken, refreshToken, accessTokenExpiresAt, idleSeconds, absoluteSeconds }) {
      const sessionId = randomToken();
      const createdAt = now();
      const idleExpiresAt = new Date(createdAt.getTime() + idleSeconds * 1000);
      const absoluteExpiresAt = new Date(createdAt.getTime() + absoluteSeconds * 1000);
      const { error } = await client.from('auth_sessions').insert({
        session_hash: sha256(sessionId),
        user_id: userId,
        token_ciphertext: encryptJson(encryptionKey, { accessToken, refreshToken }),
        access_token_expires_at: accessTokenExpiresAt.toISOString(),
        idle_expires_at: idleExpiresAt.toISOString(),
        absolute_expires_at: absoluteExpiresAt.toISOString(),
        created_at: createdAt.toISOString(),
        updated_at: createdAt.toISOString(),
      });
      throwOnError(error, 'Could not establish reader session.');
      return { sessionId, idleExpiresAt, absoluteExpiresAt };
    },

    async getSession(sessionId) {
      const { data, error } = await client
        .from('auth_sessions')
        .select('user_id, token_ciphertext, access_token_expires_at, idle_expires_at, absolute_expires_at, revoked_at')
        .eq('session_hash', sha256(sessionId))
        .maybeSingle();
      throwOnError(error, 'Could not read reader session.');
      if (!data) return null;
      return {
        userId: data.user_id,
        tokens: decryptJson(encryptionKey, data.token_ciphertext),
        accessTokenExpiresAt: data.access_token_expires_at,
        idleExpiresAt: data.idle_expires_at,
        absoluteExpiresAt: data.absolute_expires_at,
        revokedAt: data.revoked_at,
      };
    },

    async updateSession(sessionId, { accessToken, refreshToken, accessTokenExpiresAt, idleExpiresAt }) {
      const update = {
        idle_expires_at: idleExpiresAt.toISOString(),
        updated_at: now().toISOString(),
      };
      if (accessToken && refreshToken && accessTokenExpiresAt) {
        update.token_ciphertext = encryptJson(encryptionKey, { accessToken, refreshToken });
        update.access_token_expires_at = accessTokenExpiresAt.toISOString();
      }
      const { error } = await client
        .from('auth_sessions')
        .update(update)
        .eq('session_hash', sha256(sessionId));
      throwOnError(error, 'Could not refresh reader session.');
    },

    async revokeSession(sessionId) {
      const { error } = await client
        .from('auth_sessions')
        .delete()
        .eq('session_hash', sha256(sessionId));
      throwOnError(error, 'Could not revoke reader session.');
    },

    async cleanupExpired(batchSize = 500) {
      const { data, error } = await client.rpc('cleanup_expired_auth_security', {
        p_batch_size: batchSize,
      });
      throwOnError(error, 'Could not clean expired authentication records.');
      return Array.isArray(data) ? data[0] : data;
    },
  };
}

module.exports = { createSupabaseAuthStore };
