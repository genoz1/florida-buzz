-- Florida Buzz production schema baseline
--
-- Captured read-only from the production Supabase PostgreSQL catalogs on
-- 2026-10-03. This contains schema/configuration only: no production rows,
-- credentials, keys, or generated content.
--
-- This is the declarative baseline for a fresh Florida Buzz Supabase project.
-- It is not a forward migration and has not been run against production.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.article_generation_queue (
  guid text primary key,
  source_url text,
  payload jsonb not null,
  status text not null default 'pending'::text
    check (status = any (array['pending'::text, 'failed'::text])),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  dek text not null,
  body_html text not null,
  category text not null,
  source_name text not null,
  source_url text not null,
  image_url text,
  fb_caption text,
  fb_posted boolean default false,
  featured boolean default false,
  published_at timestamptz default now(),
  created_at timestamptz default now(),
  is_evergreen boolean default false,
  meta_title text,
  city text,
  is_review boolean default false,
  review_type text,
  review_subject text,
  review_rating smallint
);

create table if not exists public.engagement_posts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  message text not null,
  posted_at timestamptz default now()
);

create table if not exists public.feature_promo_images (
  topic text primary key,
  image_url text not null,
  created_at timestamptz default now()
);

create table if not exists public.feature_promo_posts (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  message text not null,
  posted_at timestamptz default now()
);

create table if not exists public.not_found_log (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  referrer text,
  created_at timestamptz default now()
);

create table if not exists public.post_log (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  status text not null,
  detail text,
  created_at timestamptz default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  park text not null,
  name text not null,
  land text,
  service_type text not null,
  reservations text not null,
  dining_plan text,
  character_dining boolean default false,
  characters text,
  meal_periods text[],
  description text,
  last_verified_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.seen_feed_items (
  id uuid primary key default gen_random_uuid(),
  guid text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  subscribed_at timestamptz default now(),
  active boolean default true
);

create index if not exists article_generation_queue_status_idx
  on public.article_generation_queue (status, created_at);
create index if not exists articles_category_idx
  on public.articles (category);
create index if not exists articles_published_idx
  on public.articles (published_at desc);
create index if not exists not_found_log_created_idx
  on public.not_found_log (created_at desc);
create index if not exists not_found_log_path_idx
  on public.not_found_log (path);
create index if not exists post_log_created_idx
  on public.post_log (created_at desc);

alter table public.article_generation_queue enable row level security;
alter table public.articles enable row level security;
alter table public.engagement_posts enable row level security;
alter table public.feature_promo_images enable row level security;
alter table public.feature_promo_posts enable row level security;
alter table public.not_found_log enable row level security;
alter table public.post_log enable row level security;
alter table public.restaurants enable row level security;
alter table public.seen_feed_items enable row level security;
alter table public.subscribers enable row level security;

-- Production has no RLS policies on these tables. The server uses the
-- service-role client, which bypasses RLS; anonymous/browser access remains
-- denied. Do not add reader policies here until the authentication/security
-- phase has been explicitly approved.

-- Storage configuration required by lib/supabase.js and image maintenance
-- scripts. This is bucket configuration, not production object data.
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;

-- No application-owned public functions, triggers, views, materialized views,
-- foreign keys, or sequences existed in production at capture time.
