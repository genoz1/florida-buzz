-- Dual generate slots: create one episode on Tuesday and one on Friday (separate runs).
-- Does not enable auto-publish. Additive / idempotent.
begin;

alter table public.podcast_schedule_settings
  add column if not exists generate_weekday_b integer not null default 5
    check (generate_weekday_b >= 0 and generate_weekday_b <= 6),
  add column if not exists generate_hour_b integer not null default 7
    check (generate_hour_b >= 0 and generate_hour_b <= 23),
  add column if not exists generate_minute_b integer not null default 0
    check (generate_minute_b >= 0 and generate_minute_b <= 59);

-- Move Disney show off the old single Thursday draft that built two episodes.
update public.podcast_schedule_settings
set
  generate_weekday = 2,
  generate_hour = 7,
  generate_minute = 0,
  generate_weekday_b = 5,
  generate_hour_b = 7,
  generate_minute_b = 0,
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
