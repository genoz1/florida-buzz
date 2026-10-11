-- Automated welcome / nurture tracking for newsletter subscribers.
-- Soft-fails in app code if this table is not present yet.

create table if not exists public.subscriber_nurture (
  email text primary key,
  step integer not null default 0,
  next_at timestamptz,
  updated_at timestamptz default now()
);

create index if not exists subscriber_nurture_next_at_idx
  on public.subscriber_nurture (next_at)
  where next_at is not null;

alter table public.subscriber_nurture enable row level security;
