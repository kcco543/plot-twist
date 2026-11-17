-- PLOT TWIST! cloud saves
-- ---------------------------------------------------------------------------
-- Everything here is new and prefixed `pt_` / `plot-twist-`: no existing
-- table, bucket, policy or auth setting is changed.
--
--   pt_worlds          one row per world save per player (latest version)
--   pt_world_versions  every version a save replaced (kept for recovery)
--   pt_save_world()    the ONLY way to write a save: it refuses to replace a
--                      version the device has not seen (no silent overwrite)
--   bucket plot-twist-saves  generated map images and saved photos, private,
--                      one folder per player, files named by their SHA-256
--                      (so a file never changes once uploaded)

create table public.pt_worlds (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  world_id text not null check (world_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  revision integer not null check (revision > 0),
  name text not null default '' check (char_length(name) <= 120),
  bundle jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  deleted boolean not null default false,
  device text not null default '' check (char_length(device) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, world_id),
  constraint pt_worlds_bundle_unless_deleted check (deleted or bundle is not null)
);

create table public.pt_world_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  world_id text not null,
  revision integer not null,
  name text not null,
  bundle jsonb,
  content_hash text not null,
  deleted boolean not null,
  device text not null,
  saved_at timestamptz not null,
  replaced_at timestamptz not null default now()
);
create index pt_world_versions_lookup on public.pt_world_versions (user_id, world_id, revision desc);

alter table public.pt_worlds enable row level security;
alter table public.pt_world_versions enable row level security;

-- Players can read only their own rows. Nobody writes the tables directly.
create policy "pt_worlds: read own" on public.pt_worlds for select to authenticated using (user_id = (select auth.uid()));
create policy "pt_world_versions: read own" on public.pt_world_versions for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.pt_worlds, public.pt_world_versions from anon, authenticated, public;
grant select on public.pt_worlds, public.pt_world_versions to authenticated;

-- Save (or delete) one world. p_base_revision is the version this device last
-- saw (null when it believes the world is new to the cloud). If the cloud has
-- moved on since, nothing is written and the current version is returned.
create function public.pt_save_world(
  p_world_id text,
  p_base_revision integer,
  p_name text,
  p_bundle jsonb,
  p_content_hash text,
  p_deleted boolean,
  p_device text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.pt_worlds%rowtype;
  next_rev integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not p_deleted and p_bundle is null then
    raise exception 'a save needs its data' using errcode = '22023';
  end if;
  if p_bundle is not null and octet_length(p_bundle::text) > 25 * 1024 * 1024 then
    raise exception 'save too large' using errcode = '54000';
  end if;

  select * into cur from public.pt_worlds where user_id = uid and world_id = p_world_id for update;

  if not found then
    if p_base_revision is not null then
      return jsonb_build_object('ok', false, 'conflict', true, 'revision', null, 'content_hash', null, 'deleted', null);
    end if;
    insert into public.pt_worlds (user_id, world_id, revision, name, bundle, content_hash, deleted, device)
    values (uid, p_world_id, 1, coalesce(left(p_name, 120), ''), case when p_deleted then null else p_bundle end, p_content_hash, p_deleted, coalesce(left(p_device, 80), ''));
    return jsonb_build_object('ok', true, 'revision', 1);
  end if;

  if p_base_revision is distinct from cur.revision then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', cur.revision, 'content_hash', cur.content_hash, 'deleted', cur.deleted);
  end if;

  -- Keep the version being replaced.
  insert into public.pt_world_versions (user_id, world_id, revision, name, bundle, content_hash, deleted, device, saved_at)
  values (cur.user_id, cur.world_id, cur.revision, cur.name, cur.bundle, cur.content_hash, cur.deleted, cur.device, cur.updated_at);
  -- Keep the 30 most recent replaced versions per world.
  delete from public.pt_world_versions v
  where v.user_id = uid and v.world_id = p_world_id
    and v.id not in (select id from public.pt_world_versions where user_id = uid and world_id = p_world_id order by revision desc limit 30);

  next_rev := cur.revision + 1;
  update public.pt_worlds
     set revision = next_rev,
         name = coalesce(left(p_name, 120), ''),
         bundle = case when p_deleted then null else p_bundle end,
         content_hash = p_content_hash,
         deleted = p_deleted,
         device = coalesce(left(p_device, 80), ''),
         updated_at = now()
   where user_id = uid and world_id = p_world_id;
  return jsonb_build_object('ok', true, 'revision', next_rev);
end;
$$;

revoke all on function public.pt_save_world(text, integer, text, jsonb, text, boolean, text) from public, anon;
grant execute on function public.pt_save_world(text, integer, text, jsonb, text, boolean, text) to authenticated;

-- Private bucket for map images and photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plot-twist-saves', 'plot-twist-saves', false, 15728640, array['image/png', 'image/jpeg', 'image/webp']);

-- Path: <user id>/<sha256>.<png|jpg|webp>. Read and add only in your own folder;
-- files are never replaced or removed by the game.
create policy "plot-twist-saves: read own" on storage.objects for select to authenticated
  using (bucket_id = 'plot-twist-saves' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "plot-twist-saves: add own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plot-twist-saves'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpg|webp)$'
  );
