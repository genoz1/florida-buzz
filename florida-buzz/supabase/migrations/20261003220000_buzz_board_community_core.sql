-- Private/staging Buzz Board community core.
-- Forward-only Phase 3 migration. Production application is not authorized.

create table public.discussions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
    check (char_length(slug) between 3 and 100),
  question text not null
    check (char_length(question) between 10 and 220)
    check (question = btrim(question)),
  context text
    check (context is null or char_length(context) <= 1000),
  category text not null
    check (category in ('disney', 'universal', 'cruises', 'florida-life')),
  topic text not null
    check (char_length(topic) between 2 and 80)
    check (topic = btrim(topic)),
  source_type text not null default 'florida_buzz'
    check (source_type in ('florida_buzz', 'article')),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'locked', 'archived')),
  moderation_status text not null default 'published'
    check (moderation_status in ('published', 'held', 'removed', 'rejected')),
  related_article_id uuid references public.articles(id) on delete set null,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  starter_label text not null default 'Florida Buzz'
    check (char_length(starter_label) between 2 and 60),
  response_count integer not null default 0 check (response_count >= 0),
  reaction_count integer not null default 0 check (reaction_count >= 0),
  unique_participant_count integer not null default 0 check (unique_participant_count >= 0),
  last_activity_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index discussions_public_feed_idx
  on public.discussions (status, moderation_status, last_activity_at desc);
create index discussions_category_feed_idx
  on public.discussions (category, last_activity_at desc)
  where status in ('published', 'locked') and moderation_status = 'published';

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  author_id uuid not null references public.profiles(user_id) on delete restrict,
  parent_response_id uuid references public.responses(id) on delete restrict,
  body text not null
    check (char_length(body) between 10 and 1500)
    check (body = btrim(body)),
  normalized_body_hash text not null check (char_length(normalized_body_hash) = 64),
  moderation_status text not null default 'held'
    check (moderation_status in ('published', 'held', 'removed', 'rejected')),
  moderation_signals jsonb not null default '[]'::jsonb
    check (jsonb_typeof(moderation_signals) = 'array'),
  moderation_reviewed_at timestamptz,
  like_count integer not null default 0 check (like_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_response_id is null or parent_response_id <> id)
);

create index responses_discussion_public_idx
  on public.responses (discussion_id, created_at)
  where moderation_status = 'published' and deleted_at is null;
create index responses_parent_idx on public.responses (parent_response_id, created_at)
  where parent_response_id is not null;
create index responses_author_recent_idx on public.responses (author_id, created_at desc);
create index responses_duplicate_idx
  on public.responses (author_id, discussion_id, normalized_body_hash, created_at desc);

create table public.community_reactions (
  response_id uuid not null references public.responses(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  reaction_type text not null default 'like' check (reaction_type = 'like'),
  created_at timestamptz not null default now(),
  primary key (response_id, user_id)
);

create index community_reactions_created_idx on public.community_reactions (created_at desc);

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses(id) on delete cascade,
  reporter_id uuid not null references public.profiles(user_id) on delete cascade,
  reason text not null
    check (reason in ('spam', 'harassment', 'threatening', 'personal-information', 'scam', 'other')),
  details text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default now(),
  unique (response_id, reporter_id)
);

create index community_reports_review_idx on public.community_reports (response_id, created_at desc);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.profiles(user_id) on delete restrict,
  target_type text not null check (target_type in ('discussion', 'response', 'profile')),
  target_id uuid not null,
  action text not null
    check (action in ('approve', 'remove', 'restore', 'lock', 'unlock', 'suspend', 'block', 'activate')),
  reason text check (reason is null or char_length(reason) <= 500),
  previous_state text,
  new_state text,
  created_at timestamptz not null default now()
);

create index moderation_actions_target_idx
  on public.moderation_actions (target_type, target_id, created_at desc);
create index moderation_actions_recent_idx on public.moderation_actions (created_at desc);

create table public.discussion_impressions (
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  visitor_hash text not null check (char_length(visitor_hash) = 64),
  viewed_on date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (discussion_id, visitor_hash, viewed_on)
);

create index discussion_impressions_recent_idx
  on public.discussion_impressions (discussion_id, viewed_on desc);

create or replace function public.enforce_discussion_starter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles
  where user_id = new.created_by and status = 'active';
  if v_role <> 'admin' then
    raise exception 'only an admin profile may create a discussion';
  end if;
  if new.status in ('published', 'locked') and new.published_at is null then
    new.published_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger discussions_authorized_starter
before insert or update of created_by, status on public.discussions
for each row execute function public.enforce_discussion_starter();

create or replace function public.enforce_response_shape()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discussion_status text;
  v_discussion_moderation text;
  v_parent_discussion uuid;
  v_parent_parent uuid;
begin
  select status, moderation_status
    into v_discussion_status, v_discussion_moderation
    from public.discussions where id = new.discussion_id;
  if v_discussion_status <> 'published' or v_discussion_moderation <> 'published' then
    raise exception 'discussion is not accepting responses';
  end if;
  if new.parent_response_id is not null then
    select discussion_id, parent_response_id
      into v_parent_discussion, v_parent_parent
      from public.responses where id = new.parent_response_id;
    if v_parent_discussion is null
       or v_parent_discussion <> new.discussion_id
       or v_parent_parent is not null then
      raise exception 'replies must target a top-level response in the same discussion';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger responses_one_level_only
before insert or update of discussion_id, parent_response_id on public.responses
for each row execute function public.enforce_response_shape();

create or replace function public.enforce_reaction_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.responses r
    join public.discussions d on d.id = r.discussion_id
    where r.id = new.response_id
      and r.moderation_status = 'published'
      and r.deleted_at is null
      and d.status in ('published', 'locked')
      and d.moderation_status = 'published'
  ) then
    raise exception 'reaction target is unavailable';
  end if;
  return new;
end;
$$;

create trigger community_reactions_public_target
before insert or update on public.community_reactions
for each row execute function public.enforce_reaction_target();

create or replace function public.enforce_report_target()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.responses
    where id = new.response_id
      and moderation_status = 'published'
      and deleted_at is null
  ) then
    raise exception 'report target is unavailable';
  end if;
  return new;
end;
$$;

create trigger community_reports_public_target
before insert on public.community_reports
for each row execute function public.enforce_report_target();

create or replace function public.refresh_discussion_stats(p_discussion_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.discussions d
  set response_count = (
        select count(*)::integer from public.responses r
        where r.discussion_id = d.id
          and r.moderation_status = 'published'
          and r.deleted_at is null
      ),
      reaction_count = (
        select count(*)::integer
        from public.community_reactions cr
        join public.responses r on r.id = cr.response_id
        where r.discussion_id = d.id
          and r.moderation_status = 'published'
          and r.deleted_at is null
      ),
      unique_participant_count = (
        select count(distinct r.author_id)::integer
        from public.responses r
        join public.profiles p on p.user_id = r.author_id and p.role = 'member'
        where r.discussion_id = d.id
          and r.moderation_status = 'published'
          and r.deleted_at is null
      ),
      last_activity_at = greatest(
        d.created_at,
        coalesce((
          select max(r.created_at)
          from public.responses r
          join public.profiles p on p.user_id = r.author_id and p.role = 'member'
          where r.discussion_id = d.id
            and r.moderation_status = 'published'
            and r.deleted_at is null
        ), d.created_at),
        coalesce((
          select max(cr.created_at)
          from public.community_reactions cr
          join public.responses r on r.id = cr.response_id
          join public.profiles p on p.user_id = cr.user_id and p.role = 'member'
          where r.discussion_id = d.id
            and r.moderation_status = 'published'
            and r.deleted_at is null
        ), d.created_at)
      ),
      updated_at = clock_timestamp()
  where d.id = p_discussion_id;
end;
$$;

create or replace function public.refresh_discussion_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discussion_id uuid;
begin
  if tg_table_name = 'responses' then
    if tg_op = 'DELETE' then
      v_discussion_id := old.discussion_id;
    else
      v_discussion_id := new.discussion_id;
    end if;
  else
    if tg_op = 'DELETE' then
      select discussion_id into v_discussion_id
      from public.responses where id = old.response_id;
    else
      select discussion_id into v_discussion_id
      from public.responses where id = new.response_id;
    end if;
  end if;
  perform public.refresh_discussion_stats(v_discussion_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger responses_refresh_discussion_stats
after insert or update or delete on public.responses
for each row execute function public.refresh_discussion_stats_trigger();

create trigger reactions_refresh_discussion_stats
after insert or delete on public.community_reactions
for each row execute function public.refresh_discussion_stats_trigger();

create or replace function public.apply_report_threshold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report_count integer;
  v_discussion_id uuid;
begin
  select count(distinct reporter_id)::integer into v_report_count
  from public.community_reports where response_id = new.response_id;

  update public.responses
  set report_count = v_report_count,
      moderation_reviewed_at = null,
      moderation_status = case
        when v_report_count >= 3 and moderation_status = 'published' then 'held'
        else moderation_status
      end,
      moderation_signals = case
        when v_report_count >= 3 and moderation_status = 'published'
          then moderation_signals || '["report-threshold"]'::jsonb
        else moderation_signals
      end,
      updated_at = clock_timestamp()
  where id = new.response_id
  returning discussion_id into v_discussion_id;

  perform public.refresh_discussion_stats(v_discussion_id);
  return new;
end;
$$;

create trigger community_reports_threshold
after insert on public.community_reports
for each row execute function public.apply_report_threshold();

create or replace function public.moderate_community_response(
  p_response_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null
)
returns table (previous_state text, new_state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_discussion_id uuid;
begin
  select role into v_role from public.profiles
  where user_id = p_moderator_id and status = 'active';
  if v_role not in ('moderator', 'admin') then raise exception 'forbidden'; end if;
  if p_action not in ('approve', 'remove', 'restore') then raise exception 'invalid action'; end if;

  select moderation_status, discussion_id into previous_state, v_discussion_id
  from public.responses where id = p_response_id for update;
  if previous_state is null then raise exception 'response not found'; end if;
  new_state := case when p_action = 'remove' then 'removed' else 'published' end;

  update public.responses
  set moderation_status = new_state,
      moderation_reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_response_id;
  insert into public.moderation_actions (
    moderator_id, target_type, target_id, action, reason, previous_state, new_state
  ) values (
    p_moderator_id, 'response', p_response_id, p_action, p_reason, previous_state, new_state
  );
  perform public.refresh_discussion_stats(v_discussion_id);
  return next;
end;
$$;

create or replace function public.moderate_community_discussion(
  p_discussion_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null
)
returns table (previous_state text, new_state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles
  where user_id = p_moderator_id and status = 'active';
  if v_role not in ('moderator', 'admin') then raise exception 'forbidden'; end if;
  if p_action not in ('lock', 'unlock') then raise exception 'invalid action'; end if;

  select status into previous_state from public.discussions
  where id = p_discussion_id for update;
  if previous_state is null then raise exception 'discussion not found'; end if;
  new_state := case when p_action = 'lock' then 'locked' else 'published' end;
  update public.discussions set status = new_state, updated_at = clock_timestamp()
  where id = p_discussion_id;
  insert into public.moderation_actions (
    moderator_id, target_type, target_id, action, reason, previous_state, new_state
  ) values (
    p_moderator_id, 'discussion', p_discussion_id, p_action, p_reason, previous_state, new_state
  );
  return next;
end;
$$;

create or replace function public.moderate_community_profile(
  p_profile_id uuid,
  p_moderator_id uuid,
  p_action text,
  p_reason text default null
)
returns table (previous_state text, new_state text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles
  where user_id = p_moderator_id and status = 'active';
  if v_role <> 'admin' then raise exception 'forbidden'; end if;
  if p_profile_id = p_moderator_id then raise exception 'cannot moderate own account'; end if;
  if p_action not in ('suspend', 'block', 'activate') then raise exception 'invalid action'; end if;

  select status into previous_state from public.profiles
  where user_id = p_profile_id for update;
  if previous_state is null then raise exception 'profile not found'; end if;
  new_state := case when p_action = 'activate' then 'active' else p_action || 'ed' end;
  if p_action = 'suspend' then new_state := 'suspended'; end if;
  update public.profiles set status = new_state, updated_at = clock_timestamp()
  where user_id = p_profile_id;
  insert into public.moderation_actions (
    moderator_id, target_type, target_id, action, reason, previous_state, new_state
  ) values (
    p_moderator_id, 'profile', p_profile_id, p_action, p_reason, previous_state, new_state
  );
  return next;
end;
$$;

create or replace function public.get_buzz_board_feed(
  p_filter text default 'buzzing',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  question text,
  context text,
  category text,
  topic text,
  source_type text,
  status text,
  response_count integer,
  reaction_count integer,
  unique_participant_count integer,
  last_activity_at timestamptz,
  created_at timestamptz,
  genuine_activity_count integer,
  buzz_score numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with response_activity as (
    select
      d.id,
      count(distinct r.author_id) filter (
        where r.created_at >= statement_timestamp() - interval '7 days'
          and p.role = 'member'
      )::integer as recent_participants,
      count(*) filter (
        where r.created_at >= statement_timestamp() - interval '7 days'
          and p.role = 'member'
          and char_length(r.body) >= 40
      )::integer as substantive_responses,
      count(distinct r.parent_response_id) filter (
        where r.created_at >= statement_timestamp() - interval '7 days'
          and r.parent_response_id is not null
          and p.role = 'member'
      )::integer as reply_threads,
      count(*) filter (
        where r.created_at >= statement_timestamp() - interval '24 hours'
          and p.role = 'member'
      )::integer as velocity
    from public.discussions d
    left join public.responses r
      on r.discussion_id = d.id
     and r.moderation_status = 'published'
     and r.deleted_at is null
    left join public.profiles p on p.user_id = r.author_id
    group by d.id
  ), reaction_activity as (
    select
      d.id,
      count(distinct cr.user_id) filter (
        where cr.created_at >= statement_timestamp() - interval '7 days'
          and reactor.role = 'member'
      )::integer as recent_likes
    from public.discussions d
    left join public.responses r
      on r.discussion_id = d.id
     and r.moderation_status = 'published'
     and r.deleted_at is null
    left join public.community_reactions cr on cr.response_id = r.id
    left join public.profiles reactor on reactor.user_id = cr.user_id
    group by d.id
  ), scored as (
    select
      d.*,
      (a.substantive_responses + ra.recent_likes)::integer as genuine_activity_count,
      (
        least(a.recent_participants, 8) * 6
        + least(a.substantive_responses, 12) * 4
        + least(a.reply_threads, 6) * 3
        + least(ra.recent_likes, 15)
        + least(a.velocity, 10) * 2
        + case
            when a.substantive_responses + ra.recent_likes = 0 then 0
            else greatest(0, 12 - floor(extract(epoch from (statement_timestamp() - d.last_activity_at)) / 14400))::integer
          end
        + case when d.created_at >= statement_timestamp() - interval '48 hours' then 3 else 0 end
      )::numeric as buzz_score
    from public.discussions d
    join response_activity a on a.id = d.id
    join reaction_activity ra on ra.id = d.id
    where d.status in ('published', 'locked')
      and d.moderation_status = 'published'
      and (
        p_filter in ('buzzing', 'latest')
        or d.category = p_filter
      )
  )
  select
    s.id, s.slug, s.question, s.context, s.category, s.topic,
    s.source_type, s.status, s.response_count, s.reaction_count,
    s.unique_participant_count, s.last_activity_at, s.created_at,
    s.genuine_activity_count, s.buzz_score
  from scored s
  order by
    case when p_filter = 'latest' then 0 else s.buzz_score end desc,
    s.last_activity_at desc,
    s.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

alter table public.discussions enable row level security;
alter table public.responses enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.discussion_impressions enable row level security;

create or replace function public.is_visible_parent_response(p_response_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.responses
    where id = p_response_id
      and moderation_status = 'published'
      and deleted_at is null
  );
$$;

create policy discussions_public_read on public.discussions
  for select to anon, authenticated
  using (status in ('published', 'locked') and moderation_status = 'published');

create policy responses_public_read on public.responses
  for select to anon, authenticated
  using (
    moderation_status = 'published'
    and deleted_at is null
    and exists (
      select 1 from public.discussions d
      where d.id = discussion_id
        and d.status in ('published', 'locked')
        and d.moderation_status = 'published'
    )
    and (
      parent_response_id is null
      or public.is_visible_parent_response(parent_response_id)
    )
  );

revoke all on public.discussions, public.responses, public.community_reactions,
  public.community_reports, public.moderation_actions, public.discussion_impressions
  from public, anon, authenticated;
grant select on public.discussions, public.responses to anon, authenticated;
revoke all on function public.is_visible_parent_response(uuid) from public;
grant execute on function public.is_visible_parent_response(uuid) to anon, authenticated;
grant all on public.discussions, public.responses, public.community_reactions,
  public.community_reports, public.moderation_actions, public.discussion_impressions
  to service_role;

revoke all on function public.get_buzz_board_feed(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_buzz_board_feed(text, integer, integer)
  to service_role;

revoke all on function public.refresh_discussion_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_discussion_stats(uuid)
  to service_role;

revoke all on function public.moderate_community_response(uuid, uuid, text, text),
  public.moderate_community_discussion(uuid, uuid, text, text),
  public.moderate_community_profile(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.moderate_community_response(uuid, uuid, text, text),
  public.moderate_community_discussion(uuid, uuid, text, text),
  public.moderate_community_profile(uuid, uuid, text, text)
  to service_role;

comment on table public.discussions is
  'Florida Buzz-authored community questions. Members cannot create discussions.';
comment on table public.responses is
  'Member responses and one-level replies with moderation state and no HTML.';
comment on table public.community_reactions is
  'One like per member and response; private actor rows, public aggregate counts.';
comment on table public.community_reports is
  'Private distinct-member reports used for deterministic temporary holds.';
comment on table public.moderation_actions is
  'Private immutable audit trail for community moderation actions.';
comment on function public.get_buzz_board_feed(text, integer, integer) is
  'Deterministic service-only Buzzing/Latest/category feed with capped genuine member activity.';
