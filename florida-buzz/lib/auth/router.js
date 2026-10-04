const express = require('express');

function createAuthRouter({ service, csrf, authMiddleware, config }) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb', strict: true }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  function sendError(res, error) {
    const status = Number(error?.status) || 503;
    if (error?.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    const exposed = new Set([
      'account_unavailable',
      'auth_provider_unavailable',
      'identity_mismatch',
      'invalid_auth_input',
      'invalid_otp',
      'rate_limited',
      'turnstile_rejected',
    ]);
    return res.status(status).json({ error: exposed.has(error?.code) ? error.code : 'security_service_unavailable' });
  }

  router.get('/csrf', (req, res) => {
    res.json({ csrfToken: csrf.issue(res) });
  });

  router.post('/request-otp', csrf.requireToken, async (req, res) => {
    try {
      const result = await service.requestOtp(req.body, { ip: req.ip });
      res.status(202).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/verify-otp', csrf.requireToken, async (req, res) => {
    try {
      const result = await service.verifyOtp(req.body, { ip: req.ip });
      authMiddleware.setSessionCookie(res, result.sessionId);
      const csrfToken = csrf.issue(res);
      res.json({ user: result.user, csrfToken });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/session', authMiddleware.requireAuth, (req, res) => {
    res.json({ user: req.auth.user });
  });

  router.post('/logout', csrf.requireToken, authMiddleware.requireAuth, async (req, res) => {
    try {
      await service.logout(req.auth.sessionId);
      authMiddleware.clearSessionCookie(res);
      csrf.clear(res);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Exported middleware is the admin/moderator replacement foundation. No
  // moderation UI or public route is added in Phase 2.
  router.authMiddleware = authMiddleware;
  router.privateConfiguration = {
    sessionCookieName: config.sessionCookieName,
    secureCookies: config.secureCookies,
  };
  return router;
}

module.exports = { createAuthRouter };
