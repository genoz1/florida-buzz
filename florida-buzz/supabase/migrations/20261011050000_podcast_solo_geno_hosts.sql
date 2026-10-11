-- Align Florida Buzz: Disney show metadata with solo Geno (not Gena & Diane).
-- Safe to re-run: updates the existing seeded show row only.

begin;

update public.podcast_shows
set
  description =
    'Geno hosts Florida Buzz: Disney — an unofficial fan podcast with park news, attractions, food, resorts, events, and Disney World vacation planning. Energetic solo coverage of Magic Kingdom, EPCOT, Disney’s Animal Kingdom, Hollywood Studios, wait times, dining, and practical trip tips. Find planning guides, wait times, dining tips, and the Buzz Board at https://thefloridabuzz.com.',
  hosts = '[{"name":"Geno","role":"host"}]'::jsonb,
  cover_alt = 'Florida Buzz Disney Podcast cover — hosted by Geno',
  updated_at = now()
where slug = 'florida-buzz-disney';

commit;
