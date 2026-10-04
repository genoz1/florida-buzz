# Buzz Board private community core

Phase 3 is private/staging-only. `BUZZ_BOARD_ENABLED` defaults off, the routes
are mounted only when reader authentication is also enabled, and the migration
is not authorized for production.

## Server configuration

The Phase 2 Auth variables remain required. Phase 3 adds:

- `BUZZ_BOARD_ENABLED=true` to mount `/buzz` in the explicitly approved
  environment;
- `TURNSTILE_SITE_KEY` for the browser widget paired with the private Phase 2
  Turnstile secret;
- `COMMUNITY_MODERATION_MODE=deterministic` for development and automated
  tests. A future provider integration must be explicitly configured and must
  fail closed to `held`; Phase 3 makes no paid moderation calls.

No community variable or secret belongs in Git.

## Security boundaries

- Direct anonymous/authenticated database clients can select only published
  or locked discussions and published, non-deleted responses.
- Reaction actors, reports, impressions, moderation signals/actions, profile
  status, and account metadata are never publicly selectable.
- All writes use the server service client after session, CSRF, role, status,
  validation, and shared database-rate-limit checks.
- There is no member discussion-creation endpoint. The database additionally
  requires the starter profile to be an active admin.
- Replies can target only a top-level response in the same discussion.
- EJS output escaping is retained; response HTML, URLs, email addresses, and
  phone/contact solicitation are rejected before storage.
- Three distinct reporters temporarily hold a published response. One account
  can count only once because of the database uniqueness constraint.
- Moderation RPCs authorize the acting moderator/admin and update the target
  plus immutable audit record in one transaction.

## Deterministic Buzzing order

The service-only feed function scores recent genuine member activity:

- unique participants: 6 points each, capped at 8;
- substantive responses (40+ characters): 4 points each, capped at 12;
- active reply threads: 3 points each, capped at 6;
- distinct recent likes: 1 point each, capped at 15;
- 24-hour response velocity: 2 points each, capped at 10;
- a recency bonus only when genuine activity exists;
- a three-point, 48-hour discovery allowance for new questions.

Held, rejected, removed, deleted, staff-authored, and duplicate activity does
not increase the genuine score. The UI labels a featured conversation only
when genuine activity exists. Empty discussions invite the first response
without claiming they are trending. Fresh member activity can revive an old
discussion.

## Analytics and SEO

The browser emits only allowlisted event names and non-identifying category,
filter, action kind, or toggle state. It never sends response/reply text,
email, account/user IDs, or moderation content to GA4. Database impressions
use a private keyed daily visitor hash and are not publicly selectable.

Private Phase 3 pages send `noindex,follow`; the moderation route sends
`noindex,nofollow`. The production sitemap is unchanged.

## Phase 4 staging launch inventory

`content/buzz-board-launch-candidates.json` contains the 60-candidate editorial
review set. `npm run build:launch-inventory` deterministically selects the
approved 36 and writes both the reviewable inventory and the staging-only data
migration. `npm run test:launch-inventory` verifies that generated files have
not drifted.

The migration uses an active admin profile and passes through the Phase 3
starter trigger. It inserts no engagement, user, impression, or historical
timestamp data. See `content/BUZZ_BOARD_LAUNCH_REVIEW.md` for the factual review
and the deferred, approval-gated path for member-created discussions.

## Phase 5 article integration

Article generation returns optional discussion-worthiness metadata in the same
structured AI response; it does not make a second AI call. The integration is
disabled unless both `BUZZ_BOARD_ENABLED=true` and
`ARTICLE_BUZZ_INTEGRATION_ENABLED=true` are set. Valid high-confidence metadata
is compared locally with existing published conversations. A close match is
reused, an uncertain match is skipped, and only a distinct question creates an
article-sourced discussion through the existing admin starter invariant.

The article is saved before this optional integration runs. Any invalid
metadata, lookup failure, or discussion write failure leaves article publishing
successful and omits the Buzz module.
