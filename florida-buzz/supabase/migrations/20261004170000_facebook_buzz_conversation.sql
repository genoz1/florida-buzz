-- Persistent Facebook distribution and imported-comment foundation for Buzz Board.
-- Service-only writes/reads keep Meta identifiers and moderation state off the public API.

create table public.facebook_buzz_posts (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null unique references public.discussions(id) on delete cascade,
  facebook_post_id text not null unique check (char_length(facebook_post_id) between 3 and 200),
  facebook_photo_id text check (facebook_photo_id is null or char_length(facebook_photo_id) between 3 and 200),
  permalink_url text,
  status text not null default 'active' check (status in ('active', 'removed')),
  published_at timestamptz not null default now(),
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index facebook_buzz_posts_reconcile_idx
  on public.facebook_buzz_posts (status, last_reconciled_at nulls first)
  where status = 'active';

create table public.facebook_buzz_comments (
  id uuid primary key default gen_random_uuid(),
  facebook_comment_id text not null unique check (char_length(facebook_comment_id) between 3 and 240),
  facebook_post_id text not null references public.facebook_buzz_posts(facebook_post_id) on delete cascade,
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  parent_facebook_comment_id text,
  body text check (body is null or char_length(body) <= 8000),
  commenter_name text check (commenter_name is null or char_length(commenter_name) <= 120),
  commenter_page_scoped_id text check (commenter_page_scoped_id is null or char_length(commenter_page_scoped_id) <= 240),
  permalink_url text,
  moderation_status text not null default 'held'
    check (moderation_status in ('published', 'held', 'removed', 'rejected')),
  moderation_signals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(moderation_signals) = 'array'),
  is_hidden boolean not null default false,
  is_deleted boolean not null default false,
  facebook_created_at timestamptz,
  facebook_updated_at timestamptz,
  synchronized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index facebook_buzz_comments_public_idx
  on public.facebook_buzz_comments (discussion_id, facebook_created_at, created_at)
  where moderation_status = 'published' and is_hidden = false and is_deleted = false;
create index facebook_buzz_comments_post_idx
  on public.facebook_buzz_comments (facebook_post_id, synchronized_at);
create index facebook_buzz_comments_parent_idx
  on public.facebook_buzz_comments (parent_facebook_comment_id)
  where parent_facebook_comment_id is not null;

alter table public.facebook_buzz_posts enable row level security;
alter table public.facebook_buzz_comments enable row level security;

revoke all on public.facebook_buzz_posts, public.facebook_buzz_comments
  from public, anon, authenticated;
grant all on public.facebook_buzz_posts, public.facebook_buzz_comments
  to service_role;

comment on table public.facebook_buzz_posts is
  'Durable mapping between a Buzz Board discussion and its genuine Florida Buzz Facebook Page post.';
comment on table public.facebook_buzz_comments is
  'Moderated, source-labeled Facebook Page comments; never native Buzz Board member responses.';
