const { parseCookies } = require('./csrf');

function createAuthMiddleware({ service, config }) {
  const cookieOptions = {
    httpOnly: true,
    secure: !!config.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionAbsoluteSeconds * 1000,
  };

  function sessionId(req) {
    return parseCookies(req.headers.cookie)[config.sessionCookieName] || '';
  }

  function setSessionCookie(res, value) {
    res.cookie(config.sessionCookieName, value, cookieOptions);
  }

  function clearSessionCookie(res) {
    res.clearCookie(config.sessionCookieName, { ...cookieOptions, maxAge: undefined });
  }

  async function requireAuth(req, res, next) {
    try {
      req.auth = await service.authenticate(sessionId(req));
      next();
    } catch (error) {
      clearSessionCookie(res);
      return res.status(error.status === 403 ? 403 : 401).json({
        error: error.status === 403 ? 'account_unavailable' : 'authentication_required',
      });
    }
  }

  async function optionalAuth(req, res, next) {
    const id = sessionId(req);
    if (!id) {
      req.auth = null;
      return next();
    }
    try {
      req.auth = await service.authenticate(id);
    } catch {
      clearSessionCookie(res);
      req.auth = null;
    }
    next();
  }

  function requireRole(...roles) {
    const allowed = new Set(roles);
    return function roleAuthorization(req, res, next) {
      if (!req.auth?.user || !allowed.has(req.auth.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      next();
    };
  }

  return { clearSessionCookie, optionalAuth, requireAuth, requireRole, sessionId, setSessionCookie };
}

module.exports = { createAuthMiddleware };
