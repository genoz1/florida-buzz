-- Extend podcast assets for reusable episode visuals and YouTube upload receipts.
alter table public.podcast_assets
  drop constraint if exists podcast_assets_kind_check;

alter table public.podcast_assets
  add constraint podcast_assets_kind_check
  check (kind in ('audio', 'artwork', 'youtube_image', 'youtube'));

create unique index if not exists podcast_assets_storage_path_unique_idx
  on public.podcast_assets (storage_path);
