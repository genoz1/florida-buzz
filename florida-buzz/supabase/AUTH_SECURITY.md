# Private reader authentication and security foundation

Phase 2 is private and disabled by default. It adds no navigation, login page,
Buzz Board page, or public community action. The server mounts the unlinked
`/internal/auth/*` JSON endpoints only when `READER_AUTH_ENABLED=true`.

## Architecture

- Supabase Auth sends and verifies six-digit email OTPs through a server-only
  client with session persistence disabled.
- The browser receives only a random opaque session cookie. Supabase access and
  refresh tokens are encrypted with AES-256-GCM and stored server-side in
  `auth_sessions`; only the hash of the cookie is stored.
- Pending email addresses are encrypted in `auth_challenges`. Email is never
  copied to `profiles`, returned in session JSON, or written to logs.
- `profiles` stores only user ID, display name, role, status, and timestamps.
- Roles are `member`, `moderator`, and `admin`. Status values are `active`,
  `suspended`, and `blocked`.
- Authentication rate limits are atomic, shared PostgreSQL buckets keyed by a
  private HMAC. Raw email addresses and IP addresses are not stored in them.
- Turnstile verification is server-side. Disabled mode is permitted only for
  local/test environments; production fails configuration validation unless a
  secret is present and verification mode is enabled.
- Auth POST requests use a signed double-submit CSRF token. Auth and CSRF
  cookies are HTTP-only, `SameSite=Lax`, host-only, and `Secure` in production.
- Sessions have a 24-hour rolling idle expiration and a seven-day absolute
  expiration. Provider tokens refresh server-side; logout or detected expiry
  deletes the stored application session and its encrypted provider tokens.
- A service-role-only cleanup function removes expired challenges, invalid
  sessions, and expired rate-limit buckets in bounded batches. An advisory
  transaction lock makes the six-hour application schedule safe across
  multiple instances, and the timer is unreferenced so it cannot keep a process
  alive during shutdown.

## Private configuration eventually required

- `READER_AUTH_ENABLED=true` (leave unset until controlled activation)
- `AUTH_RUNTIME_MODE=production` (use `local` or `test` only outside production)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- existing server-only `SUPABASE_SERVICE_KEY`
- `AUTH_SECURITY_KEY`: exactly 32 random bytes encoded as base64
- `TURNSTILE_MODE=verify`
- `TURNSTILE_SECRET_KEY`

Supabase Auth must also be configured to send an email OTP code, with approved
site URLs and email delivery settings. None of that production configuration is
changed by this branch.

## Newsletter consent

The request accepts only a JSON boolean `newsletterOptIn`. Missing, false, or a
string value is treated as no consent. The existing `subscribers` table is
written only after successful OTP verification and only when the stored choice
is exactly `true`. Account creation by itself never subscribes or reactivates an
email address.

## RLS and grants

- Authenticated users may select only their own non-email `profiles` row.
- There is no anonymous profile access in Phase 2.
- There are no client insert/update/delete policies on profiles, preventing
  role or status self-escalation.
- Challenge, session, and rate-limit tables have RLS enabled, no client
  policies, and explicit privilege revocation from anonymous/authenticated
  roles. They are service-role only.
- Existing ten operational tables and their no-policy protection are unchanged.

## Admin replacement path

`createAuthMiddleware()` provides `requireAuth` and
`requireRole('moderator', 'admin')` for a future controlled migration. Existing
admin behavior is intentionally unchanged in Phase 2.

Active routes in `routes/main.js` that still use the legacy password/state are:

- `GET /admin/submit-topic`
- `POST /admin/submit-topic`
- `GET /admin/pinterest-auth`
- `GET /admin/pinterest-callback`
- `GET /admin/test-pinterest`
- `GET /admin/reprocess-images`
- `GET /admin/test-email`
- `GET /admin/preview-newsletter`
- `GET /admin/submit-review`
- `POST /admin/submit-review`
- `GET /admin/post-report`

Dormant/duplicate route source also contains legacy checks:

- `views/partials/main.js`: submit-topic GET/POST, test-email,
  preview-newsletter, submit-review GET/POST, and post-report.
- `lib/main.js`: submit-topic GET/POST and post-report.

`server.js` mounts `routes/main.js`; the duplicate files are not the active
router, but they must not be mistaken for secured replacements during cleanup.

The password appears in a query string on most GET routes and is used as the
Pinterest OAuth `state`, so it can leak through browser history, logs, and
referrers. A future migration should protect each route with the role middleware,
use a one-time OAuth state stored server-side, convert state-changing GET routes
to CSRF-protected POST routes, and remove password fields from forms only after
the replacement is activated. This branch does not risk breaking those existing
production tools.

## Existing state-changing route audit

Phase 2 CSRF middleware is scoped only to the private auth router, so current
site behavior is unchanged. Existing routes needing separate remediation are:

- `POST /subscribe` changes newsletter state but is an unauthenticated public
  form with anti-bot checks, not a session-authenticated community operation.
- `POST /admin/submit-topic` and `POST /admin/submit-review` are legacy admin
  mutations without CSRF protection.
- `GET /admin/test-pinterest`, `GET /admin/reprocess-images`,
  `GET /admin/test-email`, and `GET /admin/preview-newsletter` cause external or
  state-changing actions despite using GET.
- `GET /admin/pinterest-callback` changes credential state and currently reuses
  the admin password as OAuth state.

These should be migrated individually after authenticated admin sessions are
activated; applying global CSRF middleware now would break existing public and
admin forms.

## Dependency audit disposition

Narrow non-breaking updates were accepted for request-path dependencies:

- Express `4.22.2` to `4.22.3`, including `body-parser` `1.20.8` and `qs`
  `6.16.0`.
- Multer `2.2.0` to `2.4.0`.
- Transitive `brace-expansion` `2.1.1` to `2.1.7`.

Deferred because the available fix is a major-version change outside Phase 2:

- `image-size` `1.2.1` to 2.x (one high-severity parser DoS finding).
- `node-cron` `3.0.3` to 4.x, which would replace vulnerable transitive `uuid`
  8.x (two moderate audit entries across `node-cron`/`uuid`).

The deferred packages are runtime dependencies. Their risky parsing/scheduling
paths are unrelated to the private OTP/session implementation, and changing
them requires focused compatibility testing rather than an automatic upgrade.
