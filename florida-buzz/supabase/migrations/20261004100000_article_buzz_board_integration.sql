-- Phase 5 staging-only article -> Buzz Board relationship.
-- Forward-only. Production application is not authorized.

alter table public.articles
  add column if not exists buzz_discussion_id uuid
  references public.discussions(id) on delete set null;

create index if not exists articles_buzz_discussion_idx
  on public.articles (buzz_discussion_id)
  where buzz_discussion_id is not null;

comment on column public.articles.buzz_discussion_id is
  'Optional primary Buzz Board conversation shown on this article. Multiple articles may reuse one durable discussion.';
