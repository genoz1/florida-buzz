const { constantTimeEqual, keyedHash, randomToken } = require('./crypto');

function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const name = part.slice(0, index).trim();
    if (!name) return cookies;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = '';
    }
    return cookies;
  }, {});
}

function createCsrfProtection({ key, cookieName, secure, ttlSeconds }) {
  if (!key) throw new Error('CSRF key is required.');

  const cookieOptions = {
    httpOnly: true,
    secure: !!secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds * 1000,
  };

  function issue(res) {
    const token = randomToken(24);
    const signature = keyedHash(key, token);
    res.cookie(cookieName, `${token}.${signature}`, cookieOptions);
    res.set('Cache-Control', 'no-store');
    return token;
  }

  function requireToken(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const cookieValue = cookies[cookieName] || '';
    const separator = cookieValue.lastIndexOf('.');
    const cookieToken = separator > 0 ? cookieValue.slice(0, separator) : '';
    const signature = separator > 0 ? cookieValue.slice(separator + 1) : '';
    const supplied = req.get('x-csrf-token') || '';
    const signatureValid = signature && constantTimeEqual(signature, keyedHash(key, cookieToken));
    if (!cookieToken || !supplied || !signatureValid || !constantTimeEqual(cookieToken, supplied)) {
      return res.status(403).json({ error: 'csrf_rejected' });
    }
    next();
  }

  function clear(res) {
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
  }

  return { clear, issue, requireToken };
}

module.exports = { createCsrfProtection, parseCookies };
