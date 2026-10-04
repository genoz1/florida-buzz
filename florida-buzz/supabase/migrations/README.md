# Forward migrations

The production-derived baseline is `../../db/schema.sql` and represents the
already-existing production structure. It must not be replayed as a new
migration.

`20261003170000_private_auth_security_foundation.sql` is the first forward
migration. It was applied to and validated against the isolated
`florida-buzz-staging` project on 2026-10-03. It remains intentionally
unapplied to production and requires separate explicit production approval.

`20261003220000_buzz_board_community_core.sql` is the Phase 3 private
community migration. It defines the Buzz Board data model, read-only public
RLS, service-only writes, report threshold, audit-backed moderation RPCs, and
deterministic capped ranking. It may be applied only to the approved staging
project until a separate production change is authorized.

`20261003233000_buzz_board_launch_inventory.sql` is the Phase 4 controlled
content migration. It inserts exactly 36 Florida Buzz-authored starter
discussions through an active admin profile and deliberately inserts no member
activity. It was prepared for `florida-buzz-staging` only; production use
requires separate explicit approval.

`20261004100000_article_buzz_board_integration.sql` is the Phase 5 staging-only
relationship migration. It gives each article an optional primary Buzz Board
discussion while allowing one durable discussion to be reused by many relevant
articles. It creates no discussions or engagement data by itself.

`20261004170000_facebook_buzz_conversation.sql` stores the durable relationship
between a Buzz Board discussion and its Facebook Page post plus moderated,
source-labeled Facebook comments. Both tables are service-only under RLS; no
Facebook identity is converted into a Buzz Board member account.
