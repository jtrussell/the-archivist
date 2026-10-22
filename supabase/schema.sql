-- The Archivist — Supabase schema (canonical fresh-install state)
--
-- Paste this whole file into the Supabase SQL Editor and run it once for a NEW
-- project. For an EXISTING database, apply supabase/migrations/*.sql in order
-- instead (0001 additive, 0002 backfill, 0003 cleanup) so live data is migrated
-- safely. This file reflects the end state those migrations converge to.

create table public.labels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Globally-shared, public deck reference data. One canonical row per real deck
-- (keyed by mv_id once resolved). Holds only non-sensitive facts — NEVER the
-- scanned codes, which stay on `scans` under per-user RLS.
create table public.decks (
  id                 uuid primary key default gen_random_uuid(), -- placeholder identity, stable pre-resolution
  mv_id              uuid,                                        -- canonical Master Vault id; unique once resolved
  set_id             integer,                                     -- master-vault expansion set id
  deck_name          text,
  -- pending: no mv_id yet (name-search job will try) | exhausted: gave up
  -- unverified: mv_id asserted by a client, awaiting by-id verification
  -- resolved: confirmed by the server | invalid: asserted mv_id doesn't exist
  mv_status          text not null default 'pending'
                       check (mv_status in ('pending', 'resolved', 'exhausted', 'unverified', 'invalid')),
  mv_lookup_attempts integer not null default 0,
  mv_lookup_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index decks_mv_id_key on public.decks (mv_id) where mv_id is not null;
create index decks_unresolved_idx on public.decks (mv_lookup_at)
  where mv_id is null and mv_status <> 'exhausted';
create index decks_unverified_idx on public.decks (mv_lookup_at)
  where mv_status = 'unverified';

create table public.scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label_id   uuid not null references public.labels(id) on delete cascade,
  deck_id    text not null,        -- canonical scanned ID: MV uuid if QR was a URL, else uppercased deck code
  deck_code  text,                 -- e.g. 4Q958-HX64G-JH6P9 (when scanned as code); private to the scanning user
  deck_uuid  uuid,                 -- keyforgegame.com master-vault uuid (when scanned as URL); private
  deck_name  text,                 -- nullable; name fetch may fail offline
  name_source text check (name_source in ('api', 'manual')), -- where deck_name came from
  deck_ref   uuid not null references public.decks(id), -- the deck this scan belongs to
  is_clone   boolean not null default false, -- Ghost Galaxy deck clone (C- prefixed code)
  position   integer not null,     -- per-user, per-label incrementing counter
  scanned_at timestamptz not null, -- client-side time of scan (accurate for offline scans)
  created_at timestamptz not null default now()
);

create index scans_label_position_idx on public.scans (label_id, position desc);
create index scans_user_deck_recent_idx on public.scans (user_id, deck_id, created_at desc);
create index scans_deck_ref_idx on public.scans (deck_ref);

create table public.deck_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id    text not null,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, deck_id)
);

create table public.deck_removals (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id    text not null,
  note       text,
  removed_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);

alter table public.labels enable row level security;
alter table public.scans  enable row level security;
alter table public.decks  enable row level security;
alter table public.deck_notes enable row level security;
alter table public.deck_removals enable row level security;

create policy "own labels select" on public.labels for select using (user_id = auth.uid());
create policy "own labels insert" on public.labels for insert with check (user_id = auth.uid());
create policy "own labels update" on public.labels for update using (user_id = auth.uid());
create policy "own scans select"  on public.scans  for select using (user_id = auth.uid());
create policy "own scans insert"  on public.scans  for insert with check (user_id = auth.uid());
create policy "own scans update"  on public.scans  for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- decks is fully public reference data (no scanned codes): any authenticated
-- user may read any row. Writes go only through the SECURITY DEFINER RPCs below
-- or the service role — there is deliberately no insert/update/delete policy.
create policy "decks are public to authenticated" on public.decks for select to authenticated using (true);
create policy "own notes select" on public.deck_notes for select using (user_id = auth.uid());
create policy "own notes insert" on public.deck_notes for insert with check (user_id = auth.uid());
create policy "own notes update" on public.deck_notes for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notes delete" on public.deck_notes for delete using (user_id = auth.uid());
create policy "own removals select" on public.deck_removals for select using (user_id = auth.uid());
create policy "own removals insert" on public.deck_removals for insert with check (user_id = auth.uid());
create policy "own removals update" on public.deck_removals for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own removals delete" on public.deck_removals for delete using (user_id = auth.uid());

-- Atomic scan recording: the label upsert row-locks the label, serializing
-- max(position)+1 per (user, label); returns the assigned position (and the
-- name recorded) for the UI. SECURITY DEFINER because it also creates/links the
-- shared `decks` row; every write is scoped to auth.uid(). Manual names
-- (name_source = 'manual') are carried forward on rescan but never written to
-- `decks` — only API-sourced names may fill a shared row.
create or replace function public.record_scan(
  p_label      text,
  p_deck_id    text,
  p_deck_name  text default null,
  p_deck_code  text default null,
  p_deck_uuid  uuid default null,
  p_scanned_at timestamptz default now(),
  p_is_clone   boolean default false
) returns table (scan_id uuid, label_id uuid, "position" integer, deck_name text)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid       uuid := auth.uid();
  v_label_id  uuid;
  v_pos       integer;
  v_scan_id   uuid;
  v_deck_ref  uuid;
  v_deck_name text;
  v_name      text;
  v_source    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into labels (user_id, name)
  values (v_uid, trim(p_label))
  on conflict (user_id, name) do update set name = excluded.name
  returning id into v_label_id;

  select coalesce(max(s.position), 0) + 1 into v_pos
  from scans s where s.label_id = v_label_id;

  -- Within-user exact-identifier match: reuse the deck this user already has
  -- for this scanned identifier. A clone code keeps its C- prefix, so it never
  -- matches the original's code here; clones join their original only via
  -- attach_scans_to_deck. Cross-format / cross-user consolidation happens at
  -- mv_id resolution (link_deck_master_vault / verification).
  select s.deck_ref into v_deck_ref
  from scans s
  where s.user_id = v_uid
    and (
      (p_deck_uuid is not null and s.deck_uuid = p_deck_uuid)
      or (p_deck_code is not null and s.deck_code = p_deck_code)
      or s.deck_id = p_deck_id
    )
  limit 1;

  if v_deck_ref is null then
    insert into decks (deck_name) values (p_deck_name)
    returning id into v_deck_ref;
  elsif p_deck_name is not null then
    -- Only an API-sourced name may fill a nameless shared row
    update decks d set deck_name = coalesce(d.deck_name, p_deck_name), updated_at = now()
    where d.id = v_deck_ref and d.deck_name is null;
  end if;

  -- Name stored on this scan row: the API's answer, else the shared deck's
  -- name, else whatever this user last recorded for this copy (so a manually
  -- entered name survives a rescan). Manual names never flow into `decks`.
  select d.deck_name into v_deck_name from decks d where d.id = v_deck_ref;
  if p_deck_name is not null then
    v_name := p_deck_name; v_source := 'api';
  elsif v_deck_name is not null then
    v_name := v_deck_name; v_source := 'api';
  else
    select s.deck_name, s.name_source into v_name, v_source
    from scans s
    where s.user_id = v_uid and s.deck_id = p_deck_id and s.deck_name is not null
    order by s.created_at desc
    limit 1;
  end if;

  insert into scans (user_id, label_id, deck_id, deck_code, deck_uuid, deck_name, name_source,
                     deck_ref, position, scanned_at, is_clone)
  values (v_uid, v_label_id, p_deck_id, p_deck_code, p_deck_uuid, v_name, v_source,
          v_deck_ref, v_pos, p_scanned_at, coalesce(p_is_clone, false))
  returning id into v_scan_id;

  delete from deck_removals r
  where r.user_id = v_uid
    and (
      r.deck_id = p_deck_id
      or (
        not coalesce(p_is_clone, false)
        and r.deck_id in (
          select s.deck_id from scans s
          where s.user_id = v_uid and s.deck_ref = v_deck_ref and not s.is_clone
        )
      )
    );

  return query select v_scan_id, v_label_id, v_pos, v_name;
end $$;

revoke execute on function public.record_scan(text, text, text, text, uuid, timestamptz, boolean) from anon;
grant execute on function public.record_scan(text, text, text, text, uuid, timestamptz, boolean) to authenticated;


-- Manual escape hatch: attach all of the caller's scans of one identifier
-- (typically a clone code, or an original the API couldn't name) to a deck —
-- either a Master Vault id hydrated client-side (created 'unverified'; the job
-- confirms it by id) or a deck already in the caller's collection. Only the
-- caller's scans move; existing canonical rows are never overwritten.
create or replace function public.attach_scans_to_deck(
  p_deck_id         text,
  p_mv_id           uuid    default null,
  p_set_id          integer default null,
  p_name            text    default null,
  p_target_deck_ref uuid    default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_canonical uuid;
  v_old       uuid[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if (p_mv_id is null) = (p_target_deck_ref is null) then
    raise exception 'Provide exactly one of p_mv_id or p_target_deck_ref';
  end if;
  if not exists (select 1 from scans s where s.user_id = v_uid and s.deck_id = p_deck_id) then
    raise exception 'No scans of % in your collection', p_deck_id;
  end if;

  if p_target_deck_ref is not null then
    if not exists (select 1 from scans s where s.user_id = v_uid and s.deck_ref = p_target_deck_ref) then
      raise exception 'Target deck is not in your collection';
    end if;
    v_canonical := p_target_deck_ref;
  else
    insert into decks (mv_id, set_id, deck_name, mv_status)
    values (p_mv_id, p_set_id, p_name, 'unverified')
    on conflict (mv_id) where mv_id is not null
    do update set set_id     = coalesce(decks.set_id, excluded.set_id),
                  deck_name  = coalesce(decks.deck_name, excluded.deck_name),
                  -- a re-asserted 'invalid' id gets another verification pass;
                  -- an existing 'resolved' row is left exactly as it is
                  mv_status  = case when decks.mv_status = 'invalid' then 'unverified'
                                    else decks.mv_status end,
                  updated_at = now()
    returning id into v_canonical;
  end if;

  select array_agg(distinct s.deck_ref) into v_old
  from scans s
  where s.user_id = v_uid and s.deck_id = p_deck_id and s.deck_ref <> v_canonical;

  update scans s set deck_ref = v_canonical
  where s.user_id = v_uid and s.deck_id = p_deck_id and s.deck_ref <> v_canonical;

  delete from decks d
  where d.id = any (coalesce(v_old, '{}'))
    and d.mv_id is null
    and not exists (select 1 from scans s where s.deck_ref = d.id);

  return v_canonical;
end $$;

revoke execute on function public.attach_scans_to_deck(text, uuid, integer, text, uuid) from anon;
grant execute on function public.attach_scans_to_deck(text, uuid, integer, text, uuid) to authenticated;


-- Resolution primitive (client fast-path): upsert the canonical deck row keyed
-- by mv_id as 'unverified' and, if it already existed, merge this placeholder
-- onto it (repoint the caller's own scans, delete the orphan). Never overwrites
-- an existing row's name/set_id/status. p_mv_id = null records a failed
-- attempt (marks 'exhausted' past a threshold).
create or replace function public.link_deck_master_vault(
  p_deck_ref uuid,
  p_mv_id    uuid,
  p_set_id   integer default null,
  p_name     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_canonical uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_mv_id is null then
    update decks
      set mv_lookup_attempts = mv_lookup_attempts + 1,
          mv_lookup_at = now(),
          mv_status = case when mv_lookup_attempts + 1 >= 5 then 'exhausted' else mv_status end,
          updated_at = now()
      where id = p_deck_ref;
    return p_deck_ref;
  end if;

  insert into decks (mv_id, set_id, deck_name, mv_status)
  values (p_mv_id, p_set_id, p_name, 'unverified')
  on conflict (mv_id) where mv_id is not null
  do update set set_id     = coalesce(decks.set_id, excluded.set_id),
                deck_name  = coalesce(decks.deck_name, excluded.deck_name),
                mv_status  = case when decks.mv_status = 'invalid' then 'unverified'
                                  else decks.mv_status end,
                updated_at = now()
  returning id into v_canonical;

  if v_canonical is distinct from p_deck_ref then
    update scans set deck_ref = v_canonical
      where deck_ref = p_deck_ref and user_id = auth.uid();
    delete from decks
      where id = p_deck_ref
        and mv_id is null
        and not exists (select 1 from scans where deck_ref = p_deck_ref);
  end if;

  return v_canonical;
end $$;


revoke execute on function public.link_deck_master_vault(uuid, uuid, integer, text) from anon;
grant execute on function public.link_deck_master_vault(uuid, uuid, integer, text) to authenticated;

-- Admin variant (service-role / cron only): repoints ALL scans that reference
-- the placeholder, since the background job canonicalizes across every user.
create or replace function public.link_deck_master_vault_admin(
  p_deck_ref uuid,
  p_mv_id    uuid,
  p_set_id   integer default null,
  p_name     text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_canonical uuid;
begin
  if p_mv_id is null then
    update decks
      set mv_lookup_attempts = mv_lookup_attempts + 1,
          mv_lookup_at = now(),
          mv_status = case when mv_lookup_attempts + 1 >= 5 then 'exhausted' else mv_status end,
          updated_at = now()
      where id = p_deck_ref;
    return p_deck_ref;
  end if;

  insert into decks (mv_id, set_id, deck_name, mv_status, mv_lookup_at)
  values (p_mv_id, p_set_id, p_name, 'resolved', now())
  on conflict (mv_id) where mv_id is not null
  do update set set_id    = coalesce(excluded.set_id, decks.set_id),
                deck_name = coalesce(decks.deck_name, excluded.deck_name),
                mv_status = 'resolved',
                mv_lookup_at = now(),
                updated_at = now()
  returning id into v_canonical;

  if v_canonical is distinct from p_deck_ref then
    update scans set deck_ref = v_canonical where deck_ref = p_deck_ref;
    delete from decks
      where id = p_deck_ref
        and not exists (select 1 from scans where deck_ref = p_deck_ref);
  end if;

  return v_canonical;
end $$;

revoke execute on function public.link_deck_master_vault_admin(uuid, uuid, integer, text) from anon, authenticated;
grant execute on function public.link_deck_master_vault_admin(uuid, uuid, integer, text) to service_role;

-- Claims a batch of 'unverified' decks (SKIP LOCKED + stamp, 1h backoff so a
-- transient API failure is retried soon) and returns their asserted mv_id.
create or replace function public.decks_pending_verification(p_limit integer default 25)
returns table (id uuid, mv_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select d.id
    from public.decks d
    where d.mv_status = 'unverified'
      and d.mv_id is not null
      and (d.mv_lookup_at is null or d.mv_lookup_at < now() - interval '1 hour')
    order by d.mv_lookup_at nulls first
    limit p_limit
    for update skip locked
  )
  update public.decks d
  set mv_lookup_at = now(), updated_at = now()
  from claimed c
  where d.id = c.id
  returning d.id, d.mv_id;
end $$;

revoke execute on function public.decks_pending_verification(integer) from anon, authenticated;
grant execute on function public.decks_pending_verification(integer) to service_role;

-- Records the server's verdict. A valid id overwrites name/set_id with the
-- Master Vault's answer (API truth beats any client assertion); an invalid id
-- flags the row so the UI can ask the user to re-link.
create or replace function public.verify_deck_admin(
  p_deck_ref uuid,
  p_valid    boolean,
  p_name     text    default null,
  p_set_id   integer default null
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_valid then
    update decks
      set deck_name    = coalesce(p_name, deck_name),
          set_id       = coalesce(p_set_id, set_id),
          mv_status    = 'resolved',
          mv_lookup_at = now(),
          updated_at   = now()
      where id = p_deck_ref;
  else
    update decks
      set mv_status          = 'invalid',
          mv_lookup_attempts = mv_lookup_attempts + 1,
          mv_lookup_at       = now(),
          updated_at         = now()
      where id = p_deck_ref;
  end if;
end $$;

revoke execute on function public.verify_deck_admin(uuid, boolean, text, integer) from anon, authenticated;
grant execute on function public.verify_deck_admin(uuid, boolean, text, integer) to service_role;

-- Work queue for the background job (service-role / cron only): CLAIMS a small
-- batch of unresolved decks and returns each with one representative scan's
-- private code/uuid (preferring a non-clone scan). Claiming = FOR UPDATE SKIP
-- LOCKED + stamping mv_lookup_at at selection, so concurrent or stacked
-- invocations get disjoint rows and a claimed row is not re-handed-out until
-- the 24h backoff. Keep p_limit small.
create or replace function public.decks_pending_resolution(p_limit integer default 25)
returns table (id uuid, deck_name text, deck_code text, deck_uuid uuid)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select d.id
    from public.decks d
    where d.mv_id is null
      and d.deck_name is not null
      and d.mv_status <> 'exhausted'
      and (d.mv_lookup_at is null or d.mv_lookup_at < now() - interval '1 day')
    order by d.mv_lookup_at nulls first
    limit p_limit
    for update skip locked
  ),
  stamped as (
    update public.decks d
    set mv_lookup_at = now(), updated_at = now()
    from claimed c
    where d.id = c.id
    returning d.id, d.deck_name
  )
  select st.id, st.deck_name, sc.deck_code, sc.deck_uuid
  from stamped st
  left join lateral (
    select s.deck_code, s.deck_uuid
    from public.scans s
    where s.deck_ref = st.id
    order by s.is_clone asc, s.created_at desc
    limit 1
  ) sc on true;
end $$;


revoke execute on function public.decks_pending_resolution(integer) from anon, authenticated;
grant execute on function public.decks_pending_resolution(integer) to service_role;

-- Delete the calling user's account and all their data. security definer so it
-- can remove the auth.users row; labels/scans cascade from the FK. Irreversible.
create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_account from anon, public;
grant execute on function public.delete_account to authenticated;

create or replace function public.delete_deck_copy(p_deck_ids text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_deck_refs uuid[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select array_agg(distinct s.deck_ref) into v_deck_refs
  from scans s
  where s.user_id = v_uid and s.deck_id = any (p_deck_ids);

  delete from scans s where s.user_id = v_uid and s.deck_id = any (p_deck_ids);
  delete from deck_notes n where n.user_id = v_uid and n.deck_id = any (p_deck_ids);
  delete from deck_removals r where r.user_id = v_uid and r.deck_id = any (p_deck_ids);

  delete from decks d
  where d.id = any (coalesce(v_deck_refs, '{}'))
    and d.mv_id is null
    and not exists (select 1 from scans s where s.deck_ref = d.id);
end $$;

revoke execute on function public.delete_deck_copy(text[]) from anon, public;
grant execute on function public.delete_deck_copy(text[]) to authenticated;

-- Current location per deck copy (most recent scan wins); security_invoker so
-- RLS applies. Canonical name/mv_id/set_id/mv_status come from `decks` (name
-- falls back to the scan's own value, e.g. a manual name). One row per scanned
-- identifier: a clone is its own row, flagged is_clone.
create or replace view public.current_deck_locations
with (security_invoker = true) as
select distinct on (s.user_id, s.deck_id)
  s.id as scan_id, s.user_id, s.deck_id,
  coalesce(d.deck_name, s.deck_name) as deck_name,
  s.deck_code, s.deck_uuid,
  d.mv_id,
  d.set_id,
  l.name as label, s.position, s.scanned_at, s.created_at,
  s.deck_ref,
  s.is_clone,
  s.name_source,
  d.mv_status,
  r.removed_at,
  r.note as removal_note
from public.scans s
join public.labels l on l.id = s.label_id
left join public.decks d on d.id = s.deck_ref
left join public.deck_removals r on r.user_id = s.user_id and r.deck_id = s.deck_id
order by s.user_id, s.deck_id, s.created_at desc;

