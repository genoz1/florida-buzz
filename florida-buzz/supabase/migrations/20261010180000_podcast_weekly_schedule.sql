-- Weekly Disney podcast draft scheduling (Florida Buzz only).
-- Additive. Does not auto-publish. Does not enable fal generation.
begin;

alter table public.podcast_episode_sources
  add column if not exists source_kind text not null default 'custom'
    check (source_kind in ('article', 'guide', 'buzz_board', 'evergreen_topic', 'custom')),
  add column if not exists external_ref text,
  add column if not exists meta jsonb not null default '{}'::jsonb;

alter table public.podcast_episodes
  add column if not exists week_key text,
  add column if not exists generation_run_id uuid;

create table if not exists public.podcast_schedule_settings (
  id uuid primary key default gen_random_uuid(),
  show_slug text not null unique,
  weekly_draft_enabled boolean not null default false,
  timezone text not null default 'America/New_York',
  generate_weekday integer not null default 4
    check (generate_weekday >= 0 and generate_weekday <= 6),
  generate_hour integer not null default 19
    check (generate_hour >= 0 and generate_hour <= 23),
  generate_minute integer not null default 0
    check (generate_minute >= 0 and generate_minute <= 59),
  intended_publish_weekday integer not null default 5
    check (intended_publish_weekday >= 0 and intended_publish_weekday <= 6),
  intended_publish_hour integer not null default 6
    check (intended_publish_hour >= 0 and intended_publish_hour <= 23),
  intended_publish_minute integer not null default 0
    check (intended_publish_minute >= 0 and intended_publish_minute <= 59),
  -- Kept false: Friday 6am ET is the intended release target, not an active auto-publisher.
  auto_publish_enabled boolean not null default false,
  notify_email text,
  updated_at timestamptz not null default now()
);

insert into public.podcast_schedule_settings (show_slug)
values ('florida-buzz-disney')
on conflict (show_slug) do nothing;

create table if not exists public.podcast_generation_runs (
  id uuid primary key default gen_random_uuid(),
  show_slug text not null,
  week_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'draft_ready', 'failed', 'rejected')),
  attempt integer not null default 1,
  episode_id uuid references public.podcast_episodes(id) on delete set null,
  error_detail text,
  payload jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_slug, week_key, attempt)
);

create index if not exists podcast_generation_runs_show_week_idx
  on public.podcast_generation_runs (show_slug, week_key, created_at desc);

create index if not exists podcast_generation_runs_status_idx
  on public.podcast_generation_runs (status, updated_at desc);

alter table public.podcast_episodes
  drop constraint if exists podcast_episodes_generation_run_id_fkey;
alter table public.podcast_episodes
  add constraint podcast_episodes_generation_run_id_fkey
  foreign key (generation_run_id) references public.podcast_generation_runs(id);

alter table public.podcast_schedule_settings enable row level security;
alter table public.podcast_generation_runs enable row level security;

commit;
