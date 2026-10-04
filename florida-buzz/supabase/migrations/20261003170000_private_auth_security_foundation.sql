-- Private reader authentication and security foundation.
-- Forward-only Phase 2 migration. Do not apply until controlled staging and
-- production activation are explicitly approved.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    check (char_length(display_name) between 2 and 40)
    check (display_name = btrim(display_name)),
  role text not null default 'member'
    check (role in ('member', 'moderator', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_status_idx on public.profiles (role, status);

create table public.auth_challenges (
  challenge_hash text primary key check (char_length(challenge_hash) = 64),
  email_ciphertext text not null,
  display_name text not null
    check (char_length(display_name) between 2 and 40)
    check (display_name = btrim(display_name)),
  newsletter_opt_in boolean not null default false,
  otp_attempts integer not null default 0 check (otp_attempts between 0 and 20),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index auth_challenges_expires_idx on public.auth_challenges (expires_at);

create table public.auth_sessions (
  session_hash text primary key check (char_length(session_hash) = 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_ciphertext text not null,
  access_token_expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (idle_expires_at <= absolute_expires_at)
);

create index auth_sessions_user_idx on public.auth_sessions (user_id);
create index auth_sessions_expiry_idx on public.auth_sessions (absolute_expires_at)
  where revoked_at is null;
create index auth_sessions_idle_expiry_idx on public.auth_sessions (idle_expires_at)
  where revoked_at is null;

create table public.auth_rate_limits (
  bucket_key text primary key check (char_length(bucket_key) = 64),
  window_started_at timestamptz not null,
  hit_count integer not null check (hit_count >= 0),
  expires_at timestamptz not null
);

create index auth_rate_limits_expiry_idx on public.auth_rate_limits (expires_at);

alter table public.profiles enable row level security;
alter table public.auth_challenges enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.auth_rate_limits enable row level security;

-- A signed-in reader can inspect only their own non-email profile fields.
-- Profile creation and all changes remain server-only in Phase 2 so a client
-- cannot grant itself a role or change an account status.
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.profiles from public, anon, authenticated;
grant select (user_id, display_name, role, status, created_at, updated_at)
  on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Challenge/session rows contain encrypted email or provider tokens and are
-- never directly readable through the Data API, including by authenticated
-- readers. There are deliberately no RLS policies for these tables.
revoke all on public.auth_challenges from public, anon, authenticated;
revoke all on public.auth_sessions from public, anon, authenticated;
revoke all on public.auth_rate_limits from public, anon, authenticated;
grant all on public.auth_challenges to service_role;
grant all on public.auth_sessions to service_role;
grant all on public.auth_rate_limits to service_role;

create or replace function public.consume_auth_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  current_count integer;
  current_window timestamptz;
begin
  if char_length(p_bucket_key) <> 64
     or p_limit < 1 or p_limit > 10000
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit parameters';
  end if;

  insert into public.auth_rate_limits (
    bucket_key,
    window_started_at,
    hit_count,
    expires_at
  ) values (
    p_bucket_key,
    v_now,
    1,
    v_now + make_interval(secs => p_window_seconds)
  )
  on conflict (bucket_key) do update
  set window_started_at = case
        when auth_rate_limits.expires_at <= v_now then v_now
        else auth_rate_limits.window_started_at
      end,
      hit_count = case
        when auth_rate_limits.expires_at <= v_now then 1
        else auth_rate_limits.hit_count + 1
      end,
      expires_at = case
        when auth_rate_limits.expires_at <= v_now
          then v_now + make_interval(secs => p_window_seconds)
        else auth_rate_limits.expires_at
      end
  returning auth_rate_limits.hit_count, auth_rate_limits.window_started_at
  into current_count, current_window;

  allowed := current_count <= p_limit;
  remaining := greatest(p_limit - current_count, 0);
  retry_after_seconds := greatest(
    ceil(extract(epoch from (current_window + make_interval(secs => p_window_seconds) - v_now)))::integer,
    0
  );
  return next;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.cleanup_expired_auth_security(
  p_batch_size integer default 500
)
returns table (
  lock_acquired boolean,
  challenges_deleted integer,
  sessions_deleted integer,
  rate_limits_deleted integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'invalid cleanup batch size';
  end if;

  lock_acquired := pg_try_advisory_xact_lock(727879112653674221::bigint);
  challenges_deleted := 0;
  sessions_deleted := 0;
  rate_limits_deleted := 0;

  if not lock_acquired then
    return next;
    return;
  end if;

  with expired as (
    select ctid
    from public.auth_challenges
    where expires_at <= v_now
    order by expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.auth_challenges target
  using expired
  where target.ctid = expired.ctid;
  get diagnostics challenges_deleted = row_count;

  with expired as (
    select ctid
    from public.auth_sessions
    where revoked_at is not null
       or idle_expires_at <= v_now
       or absolute_expires_at <= v_now
    order by least(idle_expires_at, absolute_expires_at)
    limit p_batch_size
    for update skip locked
  )
  delete from public.auth_sessions target
  using expired
  where target.ctid = expired.ctid;
  get diagnostics sessions_deleted = row_count;

  with expired as (
    select ctid
    from public.auth_rate_limits
    where expires_at <= v_now
    order by expires_at
    limit p_batch_size
    for update skip locked
  )
  delete from public.auth_rate_limits target
  using expired
  where target.ctid = expired.ctid;
  get diagnostics rate_limits_deleted = row_count;

  return next;
end;
$$;

revoke all on function public.cleanup_expired_auth_security(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_auth_security(integer)
  to service_role;

comment on table public.profiles is
  'Private reader profile and authorization role/status; email remains in Supabase Auth.';
comment on table public.auth_challenges is
  'Server-only encrypted pending email OTP challenges.';
comment on table public.auth_sessions is
  'Server-only encrypted provider tokens keyed by a hashed opaque session cookie.';
comment on table public.auth_rate_limits is
  'Shared hashed rate-limit buckets for multi-instance authentication security.';
