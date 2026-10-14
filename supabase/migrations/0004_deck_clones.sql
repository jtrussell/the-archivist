-- Migration 0004 — Deck clones, manual deck details, server-side verification
--
-- Ghost Galaxy "deck clones" are reprints that share the original's Master
-- Vault record but carry their own printed code with a `C-` prefix. The public
-- Master Vault API cannot resolve a clone code (it 404s like an unknown code),
-- so a clone can only be named by linking it to its original. This migration:
--
--   * Flags clone scans (`scans.is_clone`) and records where a scan's name came
--     from (`scans.name_source`: 'api' or 'manual').
--   * Adds `attach_scans_to_deck`: the manual escape hatch. The caller attaches
--     one of THEIR scanned identifiers (a clone code, or an original the API
--     couldn't name) to a deck — either a Master Vault id (hydrated client-side
--     from a pasted MV link) or a deck already in their collection.
--   * Hardens the shared `decks` table against clobbering: client RPCs may only
--     CREATE a canonical row (flagged 'unverified') or FILL NULL fields; they
--     never overwrite an existing name/set_id/status. Manual names never touch
--     `decks` at all — they live on the user's own `scans` rows under RLS.
--   * Adds a verification queue for the background job: 'unverified' rows are
--     re-fetched from the Master Vault by id and overwritten with API truth
--     ('resolved'), or marked 'invalid' when the id doesn't exist.
--
-- Backward compatible: all columns are additive with defaults, the view only
-- appends columns, and record_scan's new parameter has a default so clients
-- built before this migration keep working. Apply BEFORE deploying the client.

begin;

-- 1. scans: clone flag + name provenance ------------------------------------

alter table public.scans
  add column if not exists is_clone boolean not null default false;

alter table public.scans
  add column if not exists name_source text
    check (name_source in ('api', 'manual'));

-- 2. decks: new lifecycle states ---------------------------------------------
--
--   pending    -> no mv_id yet; the name-search job will try to resolve it
--   exhausted  -> name-search gave up
--   unverified -> mv_id asserted by a client; awaiting by-id verification
--   resolved   -> mv_id confirmed by the server against the Master Vault
--   invalid    -> asserted mv_id does not exist in the Master Vault

alter table public.decks drop constraint if exists decks_mv_status_check;
alter table public.decks add constraint decks_mv_status_check
  check (mv_status in ('pending', 'resolved', 'exhausted', 'unverified', 'invalid'));

create index if not exists decks_unverified_idx on public.decks (mv_lookup_at)
  where mv_status = 'unverified';

-- 3. record_scan: clone flag, name carry-forward, returns the name ------------
--
-- Dropped and recreated (new parameter + extra return column). The new
-- parameter defaults to false, so old clients calling the 6-argument form
-- resolve to this function unchanged.

drop function if exists public.record_scan(text, text, text, text, uuid, timestamptz);

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

  return query select v_scan_id, v_label_id, v_pos, v_name;
end $$;

revoke execute on function public.record_scan(text, text, text, text, uuid, timestamptz, boolean) from anon;
grant execute on function public.record_scan(text, text, text, text, uuid, timestamptz, boolean) to authenticated;

-- 4. attach_scans_to_deck: the manual escape hatch ---------------------------
--
-- Attaches all of the CALLER's scans of one identifier (p_deck_id — typically a
-- clone code) to a deck, given exactly one of:
--   p_mv_id          a Master Vault id (plus name/set_id the client hydrated
--                    from the API). Creates the canonical row as 'unverified'
--                    if new; otherwise only fills NULLs. The background job
--                    verifies it against the Master Vault by id.
--   p_target_deck_ref a deck the caller already has scans attached to (e.g.
--                    "this clone belongs to that original in my collection").
-- Only the caller's own scans are repointed. The orphaned placeholder deck (no
-- mv_id, no remaining scans) is removed.

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

-- 5. link_deck_master_vault (client fast-path): no clobber, 'unverified' ------
--
-- Same contract as before, but a client-resolved id now lands as 'unverified'
-- (the job confirms it by id) and an existing canonical row is never
-- overwritten — previously the incoming set_id won.

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

-- 6. Verification queue + admin verdict (service-role / cron only) -----------

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

-- 7. decks_pending_resolution: prefer a non-clone representative scan --------

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

-- 8. View: expose the clone flag and name provenance (appended columns) ------

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
  d.mv_status
from public.scans s
join public.labels l on l.id = s.label_id
left join public.decks d on d.id = s.deck_ref
order by s.user_id, s.deck_id, s.created_at desc;

commit;
