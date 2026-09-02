-- Migration 0002 — Phase B: backfill decks for existing scans
--
-- Populates `decks` and `scans.deck_ref` for all pre-existing rows, mirroring
-- the runtime model:
--   * Resolved decks (mv_id already known) collapse to ONE canonical row per
--     mv_id, shared across users.
--   * Unresolved decks get one placeholder per (user_id, deck_id), matching the
--     within-user placeholder that record_scan creates at scan time. The
--     background job later resolves and merges these.
--
-- Idempotent: only touches scans whose deck_ref is still null. Safe to re-run.
-- Run AFTER 0001. For very large tables, the unresolved loop can be run in
-- batches by adding a LIMIT to the cursor query.

-- B1. Canonical rows for already-resolved decks (mv_id present) --------------

insert into public.decks (mv_id, set_id, deck_name, mv_status, mv_lookup_at)
select distinct on (s.mv_id)
  s.mv_id, s.set_id, s.deck_name, 'resolved', now()
from public.scans s
where s.mv_id is not null
order by s.mv_id, s.created_at desc
on conflict (mv_id) where mv_id is not null do nothing;

update public.scans s
set deck_ref = d.id
from public.decks d
where s.deck_ref is null
  and s.mv_id is not null
  and d.mv_id = s.mv_id;

-- B2. Placeholder rows for unresolved decks, one per (user_id, deck_id) ------

do $$
declare
  r      record;
  v_ref  uuid;
begin
  for r in
    select distinct on (s.user_id, s.deck_id)
      s.user_id, s.deck_id, s.deck_name
    from public.scans s
    where s.deck_ref is null
    order by s.user_id, s.deck_id, s.created_at desc
  loop
    insert into public.decks (deck_name) values (r.deck_name)
    returning id into v_ref;

    update public.scans
    set deck_ref = v_ref
    where user_id = r.user_id
      and deck_id = r.deck_id
      and deck_ref is null;
  end loop;
end $$;

-- B3. Sanity check: every scan should now be linked. Raises if any remain.

do $$
declare
  v_unlinked bigint;
begin
  select count(*) into v_unlinked from public.scans where deck_ref is null;
  if v_unlinked > 0 then
    raise exception 'Backfill incomplete: % scan(s) still have a null deck_ref', v_unlinked;
  end if;
end $$;
