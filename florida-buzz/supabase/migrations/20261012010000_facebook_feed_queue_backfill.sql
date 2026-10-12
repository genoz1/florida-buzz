-- Facebook feed deferral uses articles.fb_posted:
--   false = still waiting for a park/cruise Facebook post (cadence spacing)
--   true  = Facebook feed step finished (posted, or intentionally skipped)
--
-- Existing rows defaulted to false and were never updated. Mark them resolved
-- so a deploy does not flood the Page with years of back-catalog.

update public.articles
set fb_posted = true
where fb_posted is distinct from true;

comment on column public.articles.fb_posted is
  'Facebook feed step resolved: true after a successful park/cruise post, or after an intentional skip (non-park topic). false means still queued for spaced Facebook posting.';
