-- Migration 0001 — Phase A: normalize decks (additive, backward-compatible)
--
-- Introduces a globally-shared `decks` reference table and links each scan to
-- it via `scans.deck_ref`, WITHOUT changing any existing read behavior:
--   * `decks` holds only non-sensitive canonical facts (mv_id, set_id, name +
--     MV lookup state). It NEVER stores the scanned codes — those stay on
--     `scans` under per-user RLS.
--   * `record_scan` is rewritten to also create/link a `decks` row, and keeps
--     dual-writing the legacy denormalized columns so old clients keep working.
--   * `current_deck_locations` keeps the exact same output columns (plus an
--     additive `deck_ref`), sourcing name/mv_id/set_id from `decks` when present
--     and falling back to the legacy scan columns during the transition.
--
-- Safe to run once against the live DB. Run 0002 next to backfill existing rows.

-- 1. The shared, public decks reference table -------------------------------

create table if not exists public.decks (
  id                 uuid primary key default gen_random_uuid(), -- placeholder identity, stable pre-resolution
  mv_id              uuid,                                        -- canonical Master Vault id; unique once resolved
  set_id             integer,
  deck_name          text,
  mv_status          text not null default 'pending'
                       check (mv_status in ('pending', 'resolved', 'exhausted')),
  mv_lookup_attempts integer not null default 0,
  mv_lookup_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One canonical row per real deck (partial: many rows may be unresolved/null)
create unique index if not exists decks_mv_id_key
  on public.decks (mv_id) where mv_id is not null;

-- The background job's work queue: unresolved, not-yet-exhausted decks
create index if not exists decks_unresolved_idx
  on public.decks (mv_lookup_at) where mv_id is null and mv_status <> 'exhausted';

alter table public.decks enable row level security;

-- Fully public shared reference data: any authenticated user may read any deck
-- (it exposes no scanned codes). No insert/update/delete policy exists, so all
-- writes must go through the SECURITY DEFINER RPCs below or the service role.
drop policy if exists "decks are public to authenticated" on public.decks;
create policy "decks are public to authenticated"
  on public.decks for select to authenticated using (true);

-- 2. Link column on scans ---------------------------------------------------

alter table public.scans
  add column if not exists deck_ref uuid references public.decks(id);

create index if not exists scans_deck_ref_idx on public.scans (deck_ref);

-- 3. record_scan: create/link a deck at scan time (dual-writes legacy cols) --
--
-- Now SECURITY DEFINER because it writes the `decks` table (which authenticated
-- users cannot write directly). It still scopes every write to auth.uid().
create or replace function public.record_scan(
  p_label      text,
  p_deck_id    text,
  p_deck_name  text default null,
  p_deck_code  text default null,
  p_deck_uuid  uuid default null,
  p_scanned_at timestamptz default now()
) returns table (scan_id uuid, label_id uuid, "position" integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_label_id uuid;
  v_pos      integer;
  v_scan_id  uuid;
  v_deck_ref uuid;
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
  -- for this scanned identifier (same uuid, same code, or same legacy deck_id).
  select s.deck_ref into v_deck_ref
  from scans s
  where s.user_id = v_uid
    and s.deck_ref is not null
    and (
      (p_deck_uuid is not null and s.deck_uuid = p_deck_uuid)
      or (p_deck_code is not null and s.deck_code = p_deck_code)
      or s.deck_id = p_deck_id
    )
  limit 1;

  if v_deck_ref is null then
    -- New (to this user) identifier -> fresh placeholder deck. Cross-format /
    -- cross-user consolidation happens later at mv_id resolution (see
    -- link_deck_master_vault).
    insert into decks (deck_name) values (p_deck_name)
    returning id into v_deck_ref;
  elsif p_deck_name is not null then
    -- Opportunistically fill a name we now have but the deck lacked
    update decks set deck_name = coalesce(deck_name, p_deck_name), updated_at = now()
    where id = v_deck_ref and deck_name is null;
  end if;

  insert into scans (user_id, label_id, deck_id, deck_code, deck_uuid, deck_name, deck_ref, position, scanned_at)
  values (v_uid, v_label_id, p_deck_id, p_deck_code, p_deck_uuid, p_deck_name, v_deck_ref, v_pos, p_scanned_at)
  returning id into v_scan_id;

  return query select v_scan_id, v_label_id, v_pos;
end $$;

revoke execute on function public.record_scan(text, text, text, text, uuid, timestamptz) from anon;
grant execute on function public.record_scan(text, text, text, text, uuid, timestamptz) to authenticated;

-- 4. Resolution primitive: link a placeholder to its canonical deck ----------
--
-- Called by the client fast-path (repoints only the caller's own scans) after
-- it resolves an mv_id. Upserts the canonical public row keyed by mv_id; if a
-- canonical row already exists (same real deck resolved earlier, possibly from
-- another format or user), MERGES: repoints the caller's scans onto it and
-- deletes the now-orphan placeholder. Pass p_mv_id = null to record a failed
-- attempt (bumps attempts; marks 'exhausted' past a threshold).
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
    update scans set deck_ref = v_canonical
      where deck_ref = p_deck_ref and user_id = auth.uid();
    delete from decks
      where id = p_deck_ref
        and not exists (select 1 from scans where deck_ref = p_deck_ref);
  end if;

  return v_canonical;
end $$;

revoke execute on function public.link_deck_master_vault(uuid, uuid, integer, text) from anon;
grant execute on function public.link_deck_master_vault(uuid, uuid, integer, text) to authenticated;

-- 5. Admin resolution primitive (service-role / cron only) -------------------
--
-- Same as above but repoints ALL scans that reference the placeholder (not just
-- one user's), since the background job canonicalizes across every user. Not
-- granted to anon or authenticated; only the service role (which bypasses RLS)
-- invokes it from the Edge Function.
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

-- 5b. Work queue for the background job (service-role / cron only) -----------
--
-- CLAIMS a small batch of unresolved decks (FOR UPDATE SKIP LOCKED + stamping
-- mv_lookup_at at selection) and returns each with one representative scan's
-- private code/uuid. Claiming means concurrent / stacked invocations get
-- disjoint rows (no duplicate work) and a claimed row is not re-handed-out until
-- the 24h backoff. Keep p_limit small; the Edge Function loops over many small
-- claims within a time budget.
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
    order by s.created_at desc
    limit 1
  ) sc on true;
end $$;

revoke execute on function public.decks_pending_resolution(integer) from anon, authenticated;
grant execute on function public.decks_pending_resolution(integer) to service_role;

-- 6. View: source canonical facts from decks, keep identical output shape ----

create or replace view public.current_deck_locations
with (security_invoker = true) as
-- NOTE: `deck_ref` is appended LAST. CREATE OR REPLACE VIEW can only add new
-- columns at the end of an existing view — inserting one mid-list would rename
-- an existing column and error. Column order is irrelevant to the client, which
-- selects by name.
select distinct on (s.user_id, s.deck_id)
  s.id as scan_id, s.user_id, s.deck_id,
  coalesce(d.deck_name, s.deck_name) as deck_name,
  s.deck_code, s.deck_uuid,
  coalesce(d.mv_id, s.mv_id)   as mv_id,
  coalesce(d.set_id, s.set_id) as set_id,
  l.name as label, s.position, s.scanned_at, s.created_at,
  s.deck_ref
from public.scans s
join public.labels l on l.id = s.label_id
left join public.decks d on d.id = s.deck_ref
order by s.user_id, s.deck_id, s.created_at desc;
