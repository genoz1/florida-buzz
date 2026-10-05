-- Additive Phase 1 feature. Does not alter existing tables or social schedules.
begin;
create table public.reel_topics (
  key text primary key, title text not null, destination text not null, angle text not null,
  seed_order integer, score integer not null default 0, scores jsonb,
  status text not null default 'QUEUED' check(status in ('QUEUED','SELECTED','EXISTING_PROOF','CANDIDATE','HELD')),
  created_at timestamptz not null default now()
);
create table public.reel_packages (
  id uuid primary key default gen_random_uuid(), topic_key text not null unique references public.reel_topics(key),
  slot text not null unique, status text not null default 'WORKING'
    check(status in ('WORKING','HELD','MANUAL_REVIEW','READY_FOR_APPROVAL','APPROVED','REJECTED')),
  data jsonb not null default '{}', decision_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index reel_one_active_package on public.reel_packages ((true)) where status='WORKING';
create table public.reel_generations (
  id uuid primary key default gen_random_uuid(), package_id uuid not null references public.reel_packages(id),
  kind text not null check(kind in ('clip','narration','transcript')), shot integer not null default 0,
  attempt integer not null default 0 check(attempt in (0,1)), endpoint text not null,
  status text not null check(status in ('SUBMITTING','QUEUED','COMPLETE','FAILED')),
  input jsonb not null, quote jsonb not null, reserved_usd numeric(12,6) not null check(reserved_usd>0),
  actual_usd numeric(12,6) check(actual_usd>=0), billing jsonb,
  request_id text unique, status_url text, response_url text, result jsonb, review jsonb,
  created_at timestamptz not null default now(), unique(package_id,kind,shot,attempt)
);
create table public.reel_control (
  id boolean primary key default true check(id), token uuid, expires_at timestamptz,
  paused_reason text, updated_at timestamptz not null default now()
);
create table public.reel_idea_batches (
  week text primary key,status text not null check(status in ('CREATING','COMPLETE','HELD')),
  candidates jsonb,created_at timestamptz not null default now()
);
insert into public.reel_control(id) values(true);
alter table public.reel_topics enable row level security;
alter table public.reel_packages enable row level security;
alter table public.reel_generations enable row level security;
alter table public.reel_control enable row level security;
alter table public.reel_idea_batches enable row level security;
revoke all on public.reel_idea_batches from anon,authenticated;
grant all on public.reel_idea_batches to service_role;
revoke all on public.reel_topics,public.reel_packages,public.reel_generations,public.reel_control from anon,authenticated;
grant all on public.reel_topics,public.reel_packages,public.reel_generations,public.reel_control to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('guide-reels','guide-reels',false,104857600)
  on conflict(id) do nothing;

create function public.reels_claim(p_slot text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare c reel_control; p reel_packages; t reel_topics; lease uuid;
begin
  select * into c from reel_control where id=true for update;
  if c.expires_at>now() or c.paused_reason is not null then return null; end if;
  select * into p from reel_packages where status='WORKING' order by created_at limit 1;
  if p.id is null and p_slot is not null then
    if exists(select 1 from reel_packages where slot=p_slot) then return null; end if;
    select * into t from reel_topics where status='QUEUED'
      order by (seed_order is null),seed_order,score desc,created_at limit 1 for update skip locked;
    if t.key is null then return null; end if;
    insert into reel_packages(topic_key,slot) values(t.key,p_slot) returning * into p;
    update reel_topics set status='SELECTED' where key=t.key;
  end if;
  if p.id is null then return null; end if;
  lease:=gen_random_uuid();
  update reel_control set token=lease,expires_at=now()+interval '10 minutes',updated_at=now() where id=true;
  return jsonb_build_object('token',lease,'package',to_jsonb(p));
end $$;

create function public.reels_write(p_token uuid,p_package uuid,p_data jsonb,p_status text default 'WORKING')
returns jsonb language plpgsql security definer set search_path=public as $$
declare result reel_packages;
begin
  perform 1 from reel_control where id=true and token=p_token and expires_at>now() for update;
  if not found then raise exception 'Worker lease lost'; end if;
  update reel_packages set data=data||p_data,status=p_status,updated_at=now()
    where id=p_package and status='WORKING' returning * into result;
  if result.id is null then raise exception 'Package no longer active'; end if;
  return to_jsonb(result);
end $$;

create function public.reels_lease(p_token uuid,p_release boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update reel_control set expires_at=case when p_release then now() else now()+interval '10 minutes' end,
    updated_at=now() where id=true and token=p_token and expires_at>now();
  return found;
end $$;

create function public.reels_reserve(p_token uuid,p_package uuid,p_kind text,p_shot integer,p_attempt integer,
  p_endpoint text,p_input jsonb,p_quote jsonb,p_caps jsonb,p_balance numeric) returns jsonb
language plpgsql security definer set search_path=public as $$
declare cost numeric; total numeric; boundary timestamptz; period text; existing reel_generations; result reel_generations;
begin
  perform 1 from reel_control where id=true and token=p_token and expires_at>now() and paused_reason is null for update;
  if not found then raise exception 'Worker lease lost or paused'; end if;
  perform 1 from reel_packages where id=p_package and status='WORKING';
  if not found then raise exception 'Package not active'; end if;
  select * into existing from reel_generations where package_id=p_package and kind=p_kind and shot=p_shot and attempt=p_attempt;
  if existing.id is not null then return to_jsonb(existing)||jsonb_build_object('new_reservation',false); end if;
  if p_attempt=1 and (p_kind<>'clip' or not exists(select 1 from reel_generations
    where package_id=p_package and kind='clip' and shot=p_shot and attempt=0 and review->>'classification'='REGENERATE_ONCE'))
    then raise exception 'Replacement not authorized by review'; end if;
  cost:=(p_quote->>'amount')::numeric;
  if cost<=0 or cost>(p_caps->>'single')::numeric then raise exception 'Single request cap reached'; end if;
  foreach period in array array['package','day','week','month'] loop
    boundary:=case when period='package' then '-infinity'::timestamptz else
      date_trunc(period,now() at time zone 'America/New_York') at time zone 'America/New_York' end;
    select coalesce(sum(coalesce(actual_usd,reserved_usd)),0) into total from reel_generations
      where created_at>=boundary and (period<>'package' or package_id=p_package);
    if total+cost>(p_caps->>period)::numeric then raise exception '% spending cap reached',period; end if;
  end loop;
  select coalesce(sum(reserved_usd),0) into total from reel_generations where actual_usd is null;
  if total+cost>p_balance then raise exception 'Insufficient verified existing fal balance'; end if;
  -- SUBMITTING is deliberately committed BEFORE external POST. If receipt is lost,
  -- the worker holds this package; it never repeats an ambiguous paid submission.
  insert into reel_generations(package_id,kind,shot,attempt,endpoint,input,quote,reserved_usd,status)
    values(p_package,p_kind,p_shot,p_attempt,p_endpoint,p_input,p_quote,cost,'SUBMITTING') returning * into result;
  return to_jsonb(result)||jsonb_build_object('new_reservation',true);
end $$;

create function public.reels_generation_write(p_token uuid,p_id uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare saved_generation reel_generations;
begin
  perform 1 from reel_control where id=true and token=p_token and expires_at>now() for update;
  if not found then raise exception 'Worker lease lost'; end if;
  update reel_generations set status=coalesce(p_patch->>'status',status),
    request_id=coalesce(p_patch->>'request_id',request_id),status_url=coalesce(p_patch->>'status_url',status_url),
    response_url=coalesce(p_patch->>'response_url',response_url),result=coalesce(p_patch->'result',result),
    review=coalesce(p_patch->'review',review),actual_usd=coalesce((p_patch->>'actual_usd')::numeric,actual_usd),
    billing=coalesce(p_patch->'billing',billing) where id=p_id returning * into saved_generation;
  if saved_generation.id is null then raise exception 'Unknown generation'; end if;
  return to_jsonb(saved_generation);
end $$;
create function public.reels_pause(p_token uuid,p_reason text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update reel_control set paused_reason=p_reason where id=true and token=p_token and expires_at>now();
  return found;
end $$;
revoke all on function public.reels_pause(uuid,text) from public,anon,authenticated;
grant execute on function public.reels_pause(uuid,text) to service_role;
revoke all on function public.reels_claim(text),public.reels_write(uuid,uuid,jsonb,text),public.reels_lease(uuid,boolean),
  public.reels_reserve(uuid,uuid,text,integer,integer,text,jsonb,jsonb,jsonb,numeric),public.reels_generation_write(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reels_claim(text),public.reels_write(uuid,uuid,jsonb,text),public.reels_lease(uuid,boolean),
  public.reels_reserve(uuid,uuid,text,integer,integer,text,jsonb,jsonb,jsonb,numeric),public.reels_generation_write(uuid,uuid,jsonb) to service_role;
commit;
