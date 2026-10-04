# Supabase schema management

`../db/schema.sql` is the production-derived declarative baseline captured on
2026-10-03. It contains no production data or secrets.

The `migrations/` directory contains timestamped, forward-only changes made
after that baseline. Production did not have migration history registered when
the baseline was captured, so the baseline must not be replayed there as a new
migration. Before the first production migration is applied, link the Supabase
CLI in a controlled environment, mark the baseline as the existing state, and
verify a schema diff is empty. Do not use `db reset` against a linked production
project.

Rules for forward migrations:

- Use UTC timestamps: `YYYYMMDDHHMMSS_description.sql`.
- Make one scoped, reviewable change per migration.
- Never edit a migration after it has been applied.
- Test against a disposable local or staging database before production.
- Keep Supabase-managed `auth`, `storage`, `realtime`, and `vault` internals out
  of application migrations; only version intentional Florida Buzz objects and
  configuration.
- Reader authentication, RLS policies, and Buzz Board objects require their own
  explicitly approved phase.
