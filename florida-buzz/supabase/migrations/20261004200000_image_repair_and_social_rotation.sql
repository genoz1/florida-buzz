-- Durable, service-only article-image repair state.
-- A published article may temporarily have no image, but that state is never
-- treated as a successful image result. Candidate assets survive technical
-- review failures so the same generation can be reviewed again without paying
-- for another generation.

create table if not exists public.article_image_repairs (
  article_id uuid primary key references public.articles(id) on delete cascade,
  article_slug text not null,
  status text not null default 'pending'
    check (status in ('pending', 'review_pending', 'accepted', 'needs_manual')),
  reason text not null default 'missing_image',
  image_context jsonb not null default '{}'::jsonb,
  original_image_url text,
  candidate_image_url text,
  generation_attempts integer not null default 0 check (generation_attempts >= 0),
  provider_failures integer not null default 0 check (provider_failures >= 0),
  review_attempts integer not null default 0 check (review_attempts >= 0),
  last_error text,
  correction text,
  next_attempt_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists article_image_repairs_due_idx
  on public.article_image_repairs (status, next_attempt_at)
  where status in ('pending', 'review_pending');

alter table public.article_image_repairs enable row level security;
revoke all on public.article_image_repairs from public, anon, authenticated;
grant all on public.article_image_repairs to service_role;

comment on table public.article_image_repairs is
  'Durable fail-safe queue for missing, rejected, or technically unreviewed article imagery.';

-- Recurring distribution can eventually revisit a discussion. Preserve every
-- Facebook post ID instead of overwriting the first mapping. The latest active
-- mapping is used as the primary external conversation link, while all genuine
-- imported comments remain associated with the same Buzz Board discussion.
alter table public.facebook_buzz_posts
  drop constraint if exists facebook_buzz_posts_discussion_id_key;

create index if not exists facebook_buzz_posts_discussion_latest_idx
  on public.facebook_buzz_posts (discussion_id, published_at desc)
  where status = 'active';
