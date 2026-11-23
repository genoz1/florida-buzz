-- Persist refreshed Instagram / Threads long-lived access tokens so deploys
-- and process restarts do not fall back to an expired DigitalOcean env seed.
create table if not exists public.social_platform_tokens (
  platform text primary key,
  access_token text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint social_platform_tokens_platform_check
    check (platform in ('instagram', 'threads'))
);

alter table public.social_platform_tokens enable row level security;

-- Service role only (no public policies). Automation uses SUPABASE_SERVICE_KEY.
