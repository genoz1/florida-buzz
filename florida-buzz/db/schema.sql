-- Run this in your NEW Supabase project's SQL Editor (create a separate project from villagesgolfcarttrader)

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  dek text not null,                  -- one-sentence subhead shown on cards
  body_html text not null,            -- the AI-written article body
  category text not null,             -- 'theme-parks' | 'space' | 'beaches' | 'florida-living' | 'wildlife' | 'cruises' | 'food' | 'events'
  source_name text not null,          -- e.g. "Disney Parks Blog"
  source_url text not null,           -- link back to the original official source
  image_url text,                     -- featured image (placeholder until image-gen step is added)
  fb_caption text,                    -- the social caption generated alongside the article
  fb_posted boolean default false,
  featured boolean default false,
  is_evergreen boolean default false, -- true for reference guides (vs. dated news items); already live in Supabase, documented here for reference
  published_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists articles_category_idx on articles (category);
create index if not exists articles_published_idx on articles (published_at desc);

-- Prevents the automation from summarizing the same source story twice
create table if not exists seen_feed_items (
  id uuid primary key default gen_random_uuid(),
  guid text unique not null,
  created_at timestamptz default now()
);

-- Durable retry queue for RSS items. A provider/database failure never writes
-- the item to seen_feed_items; it stays here until it is intentionally skipped,
-- deduplicated against an existing article, or successfully published.
create table if not exists article_generation_queue (
  guid text primary key,
  source_url text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'failed')),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists article_generation_queue_status_idx
  on article_generation_queue (status, created_at);

-- Internal automation state only. The server uses the service-role client,
-- which bypasses RLS; no browser/anonymous access should be allowed.
alter table article_generation_queue enable row level security;

-- Newsletter subscribers
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  subscribed_at timestamptz default now(),
  active boolean default true
);
