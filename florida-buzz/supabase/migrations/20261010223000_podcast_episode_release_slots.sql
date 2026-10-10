-- Per-episode intended publish day for twice-weekly standalone shows (Tue + Fri).
-- Does not enable auto-publish.
begin;

alter table public.podcast_episodes
  add column if not exists intended_publish_weekday integer
    check (intended_publish_weekday is null or (intended_publish_weekday >= 0 and intended_publish_weekday <= 6)),
  add column if not exists intended_publish_hour integer
    check (intended_publish_hour is null or (intended_publish_hour >= 0 and intended_publish_hour <= 23)),
  add column if not exists intended_publish_minute integer
    check (intended_publish_minute is null or (intended_publish_minute >= 0 and intended_publish_minute <= 59));

-- Schedule settings: second intended publish slot (Friday). Existing intended_publish_*
-- remains the first weekly target and defaults to Tuesday after backfill below.
alter table public.podcast_schedule_settings
  add column if not exists intended_publish_weekday_b integer not null default 5
    check (intended_publish_weekday_b >= 0 and intended_publish_weekday_b <= 6),
  add column if not exists intended_publish_hour_b integer not null default 6
    check (intended_publish_hour_b >= 0 and intended_publish_hour_b <= 23),
  add column if not exists intended_publish_minute_b integer not null default 0
    check (intended_publish_minute_b >= 0 and intended_publish_minute_b <= 59);

-- Prefer Tuesday 6:00 AM as episode A; keep Friday 6:00 AM as episode B.
update public.podcast_schedule_settings
set
  intended_publish_weekday = 2,
  intended_publish_hour = 6,
  intended_publish_minute = 0,
  intended_publish_weekday_b = 5,
  intended_publish_hour_b = 6,
  intended_publish_minute_b = 0,
  auto_publish_enabled = false,
  updated_at = now()
where show_slug = 'florida-buzz-disney';

commit;
