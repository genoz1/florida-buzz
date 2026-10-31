-- Preserve publication dates and do not label the entire archive as modified.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

alter table public.articles add column if not exists content_updated_at timestamptz;

create or replace function public.set_article_content_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.content_updated_at := statement_timestamp();
  return new;
end;
$$;

create or replace trigger articles_content_updated_at
before update on public.articles
for each row
when (
  old.title is distinct from new.title
  or old.dek is distinct from new.dek
  or old.body_html is distinct from new.body_html
  or old.meta_title is distinct from new.meta_title
)
execute function public.set_article_content_updated_at();

-- These three revisions were published and verified on October 31 before this
-- trigger existed. Backfill only the exact reviewed bodies, leaving all other
-- archive dates untouched and avoiding a timestamp reset on later reruns.
update public.articles a
set content_updated_at = statement_timestamp()
from (values
  ('disney-s-animal-kingdom-new-food-and-drinks-2025', '7e22f46b4ba4e8e5f4f46cd0e0aed518'),
  ('off-the-beaten-path-orlando-places-and-events-to-know', 'a920074b45b39f13e2c532981f8b56e8'),
  ('disney-world-money-saving-tips-2026', 'ae3d55a8e6416729c66c52855d7d0857')
) as reviewed(slug, body_md5)
where a.slug = reviewed.slug
  and md5(a.body_html) = reviewed.body_md5
  and a.content_updated_at is null;

commit;
notify pgrst, 'reload schema';
