-- Additive Florida Buzz podcast system.
-- New tables only. Does not alter articles, reels, auth, ads, or other existing features.
-- Do not apply to production until explicitly approved.
begin;

create table if not exists public.podcast_shows (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  publisher text not null default 'The Florida Buzz',
  description text not null,
  hosts jsonb not null default '[]'::jsonb,
  disclosure text not null,
  language text not null default 'en-us',
  category text not null default 'Leisure',
  subcategory text,
  explicit boolean not null default false,
  cover_asset_id uuid,
  cover_url text,
  cover_alt text,
  intro_audio_url text,
  outro_audio_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.podcast_platform_links (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.podcast_shows(id) on delete cascade,
  platform text not null,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (show_id, platform)
);

create table if not exists public.podcast_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('audio', 'artwork')),
  storage_path text not null,
  public_url text not null,
  content_type text not null,
  byte_size bigint,
  duration_seconds integer,
  alt_text text,
  checksum text,
  created_at timestamptz not null default now()
);

alter table public.podcast_shows
  drop constraint if exists podcast_shows_cover_asset_id_fkey;
alter table public.podcast_shows
  add constraint podcast_shows_cover_asset_id_fkey
  foreign key (cover_asset_id) references public.podcast_assets(id);

create table if not exists public.podcast_episodes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.podcast_shows(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  show_notes_html text not null default '',
  episode_number integer,
  status text not null default 'draft'
    check (status in (
      'draft',
      'script_ready',
      'generating_audio',
      'preview_ready',
      'approved',
      'scheduled',
      'published',
      'failed'
    )),
  outline_json jsonb,
  script_text text,
  artwork_asset_id uuid references public.podcast_assets(id),
  artwork_url text,
  artwork_alt text,
  audio_asset_id uuid references public.podcast_assets(id),
  audio_url text,
  audio_byte_size bigint,
  audio_content_type text default 'audio/mpeg',
  duration_seconds integer,
  guid text not null unique,
  published_at timestamptz,
  scheduled_for timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_id, slug),
  unique (show_id, episode_number)
);

create index if not exists podcast_episodes_show_status_idx
  on public.podcast_episodes (show_id, status, published_at desc);
create index if not exists podcast_episodes_published_idx
  on public.podcast_episodes (published_at desc)
  where status = 'published';

create table if not exists public.podcast_episode_sources (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.podcast_episodes(id) on delete cascade,
  title text not null,
  url text not null,
  summary text,
  included boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.podcast_scripts (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.podcast_episodes(id) on delete cascade,
  version integer not null default 1,
  kind text not null check (kind in ('outline', 'conversation')),
  content_text text not null,
  content_json jsonb,
  created_at timestamptz not null default now(),
  unique (episode_id, kind, version)
);

create table if not exists public.podcast_audio_jobs (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.podcast_episodes(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  attempt integer not null default 1,
  section_index integer not null default 0,
  section_count integer not null default 1,
  fal_request_id text,
  fal_endpoint text,
  fal_model text,
  estimated_cost_usd numeric(12, 6),
  actual_cost_usd numeric(12, 6),
  error_detail text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists podcast_audio_jobs_episode_idx
  on public.podcast_audio_jobs (episode_id, created_at desc);

insert into public.podcast_shows (
  slug, title, publisher, description, hosts, disclosure, language, category, subcategory, explicit,
  cover_url, cover_alt
) values (
  'florida-buzz-disney',
  'Florida Buzz: Disney',
  'The Florida Buzz',
  'Gina and Diane are Disney-loving Central Florida moms who visit the parks frequently and discuss park news, attractions, food, resorts, events, planning advice, and their personal experiences.',
  '[{"name":"Gina","role":"host"},{"name":"Diane","role":"host"}]'::jsonb,
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.',
  'en-us',
  'Leisure',
  'Travel',
  false,
  '/img/podcasts/florida-buzz-disney-cover.svg',
  'Florida Buzz: Disney podcast cover — original Florida Buzz artwork, not affiliated with Disney'
) on conflict (slug) do nothing;

alter table public.podcast_shows enable row level security;
alter table public.podcast_platform_links enable row level security;
alter table public.podcast_assets enable row level security;
alter table public.podcast_episodes enable row level security;
alter table public.podcast_episode_sources enable row level security;
alter table public.podcast_scripts enable row level security;
alter table public.podcast_audio_jobs enable row level security;

commit;
