-- Migration 0003 — Phase D: drop legacy denormalized MV columns (CLEANUP)
--
-- ⚠️  Run this ONLY after the new client build is deployed and verified (Phase
--     C). It removes the legacy per-scan mv_id/set_id columns now owned by
--     `decks`. `deck_name` is intentionally KEPT on `scans` — the name path
--     (scan-time fetch, offline sync, retry, Settings backfill) still writes it,
--     and the view falls back to it.
--
-- Preconditions: 0001 + 0002 applied; every scan has a non-null deck_ref; the
-- deployed client writes MV info via the link_deck_master_vault RPC (never via
-- scans columns) and reads mv_id/set_id via the view or the deck_ref join.

begin;

-- deck_ref is now mandatory
alter table public.scans alter column deck_ref set not null;

-- Drop the denormalized MV columns now owned by `decks`
alter table public.scans drop column if exists mv_id;
alter table public.scans drop column if exists set_id;

-- View: mv_id/set_id now come solely from `decks`; deck_name keeps its fallback
create or replace view public.current_deck_locations
with (security_invoker = true) as
-- deck_ref stays LAST to match the column order established in 0001 (CREATE OR
-- REPLACE VIEW cannot reorder existing columns).
select distinct on (s.user_id, s.deck_id)
  s.id as scan_id, s.user_id, s.deck_id,
  coalesce(d.deck_name, s.deck_name) as deck_name,
  s.deck_code, s.deck_uuid,
  d.mv_id,
  d.set_id,
  l.name as label, s.position, s.scanned_at, s.created_at,
  s.deck_ref
from public.scans s
join public.labels l on l.id = s.label_id
left join public.decks d on d.id = s.deck_ref
order by s.user_id, s.deck_id, s.created_at desc;

commit;
