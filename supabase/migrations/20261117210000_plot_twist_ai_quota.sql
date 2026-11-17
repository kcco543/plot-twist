-- PLOT TWIST! public beta: daily AI allowances + storage caps
-- ---------------------------------------------------------------------------
-- Additive. Nothing existing is removed; the one changed policy only adds a
-- per-player file cap to the existing "add own" rule.
--
--   pt_ai_quota            daily usage counters (site / network / tester buckets).
--                          No policies: only the server (secret key) can reach it,
--                          through the two functions below.
--   pt_take_ai_quota()     atomically take units from several buckets, or none
--   pt_refund_ai_quota()   give units back when a request never reached the provider
--   pt_save_world()        now also refuses a NEW world past 60 worlds per player
--   storage "add own"      now also refuses uploads past 600 files per player

create table if not exists public.pt_ai_quota (
  bucket text not null check (char_length(bucket) <= 120),
  day date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket, day)
);
alter table public.pt_ai_quota enable row level security;
revoke all on public.pt_ai_quota from public, anon, authenticated;

create or replace function public.pt_take_ai_quota(p_buckets text[], p_limits integer[], p_cost integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date := (now() at time zone 'utc')::date;
  n integer := coalesce(array_length(p_buckets, 1), 0);
  i integer;
  cur integer;
begin
  if n = 0 or n > 8 or n <> coalesce(array_length(p_limits, 1), 0) or p_cost < 1 or p_cost > 100 then
    raise exception 'bad quota request' using errcode = '22023';
  end if;
  insert into public.pt_ai_quota (bucket, day)
  select b, d from unnest(p_buckets) as b order by b
  on conflict (bucket, day) do nothing;
  -- Lock the rows in a fixed order so concurrent requests can't deadlock.
  perform 1 from public.pt_ai_quota where day = d and bucket = any (p_buckets) order by bucket for update;
  for i in 1..n loop
    select used into cur from public.pt_ai_quota where bucket = p_buckets[i] and day = d;
    if cur + p_cost > p_limits[i] then
      return jsonb_build_object('ok', false, 'bucket', p_buckets[i]);
    end if;
  end loop;
  update public.pt_ai_quota set used = used + p_cost, updated_at = now() where day = d and bucket = any (p_buckets);
  -- Housekeeping: keep two weeks of history for monitoring.
  delete from public.pt_ai_quota where day < d - 14;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pt_refund_ai_quota(p_buckets text[], p_cost integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pt_ai_quota
     set used = greatest(0, used - least(greatest(p_cost, 0), 100)), updated_at = now()
   where day = (now() at time zone 'utc')::date and bucket = any (p_buckets[1:8]);
$$;

revoke all on function public.pt_take_ai_quota(text[], integer[], integer) from public, anon, authenticated;
revoke all on function public.pt_refund_ai_quota(text[], integer) from public, anon, authenticated;
grant execute on function public.pt_take_ai_quota(text[], integer[], integer) to service_role;
grant execute on function public.pt_refund_ai_quota(text[], integer) to service_role;

-- Per-player storage cap for cloud-save images (maps, photos, gifts).
drop policy if exists "plot-twist-saves: add own" on storage.objects;
create policy "plot-twist-saves: add own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plot-twist-saves'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'
    and (select count(*) from storage.objects o
          where o.bucket_id = 'plot-twist-saves'
            and (storage.foldername(o.name))[1] = (select auth.uid())::text) < 600
  );

-- Per-player world cap: only new worlds are refused; existing ones always save.
create or replace function public.pt_world_count_ok(uid uuid, p_world_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pt_worlds where user_id = uid and world_id = p_world_id)
      or (select count(*) from public.pt_worlds where user_id = uid and not deleted) < 60;
$$;
revoke all on function public.pt_world_count_ok(uuid, text) from public, anon, authenticated;

create or replace function public.pt_worlds_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pt_world_count_ok(new.user_id, new.world_id) then
    raise exception 'world limit reached' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function public.pt_worlds_cap() from public, anon, authenticated;

drop trigger if exists pt_worlds_cap on public.pt_worlds;
create trigger pt_worlds_cap before insert on public.pt_worlds for each row execute function public.pt_worlds_cap();
