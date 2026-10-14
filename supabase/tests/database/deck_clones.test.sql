-- pgTAP tests: deck clones, the manual escape hatch, and clobber protection.
--
-- Run with:  npx supabase start   (once)   then   npx supabase test db
-- Everything runs inside one transaction and is rolled back.
--
-- Impersonation: Supabase's auth.uid() reads the JWT claims from the session
-- settings, so we set those plus `set local role authenticated` to behave
-- exactly like a signed-in client (RLS on, SECURITY DEFINER RPCs callable).

begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id, email, instance_id, aud, role)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'bob@test.local',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A: scan an original, then a clone -----------------------------------------

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');

select is(
  (select "position" from record_scan('Box 1', '3JV94-353M2-W5JX8', 'Lòrien il Puro', '3JV94-353M2-W5JX8', null, now(), false)),
  1, 'original scan gets position 1');

select is(
  (select "position" from record_scan('Box 1', 'C-4WRXV-2W247-6QM7W', null, 'C-4WRXV-2W247-6QM7W', null, now(), true)),
  2, 'clone scan gets position 2');

-- Old 6-argument signature (clients built before 0004) still resolves
select lives_ok(
  $$ select * from record_scan('Box 1', '11111-22222-33333', 'Old Client Deck', '11111-22222-33333', null, now()) $$,
  'legacy 6-arg record_scan call still works');

select pg_temp.logout();

select is((select is_clone from scans where deck_id = 'C-4WRXV-2W247-6QM7W'), true,  'clone scan is flagged is_clone');
select is((select is_clone from scans where deck_id = '3JV94-353M2-W5JX8'),   false, 'original scan is not a clone');
select is((select is_clone from scans where deck_id = '11111-22222-33333'),   false, 'legacy call defaults is_clone to false');
select is((select name_source from scans where deck_id = '3JV94-353M2-W5JX8'), 'api', 'API-provided name is recorded as api');
select isnt(
  (select deck_ref from scans where deck_id = 'C-4WRXV-2W247-6QM7W'),
  (select deck_ref from scans where deck_id = '3JV94-353M2-W5JX8'),
  'clone and original land on different placeholder decks');
select is((select deck_name from decks where id = (select deck_ref from scans where deck_id = 'C-4WRXV-2W247-6QM7W')),
  null, 'clone placeholder deck is nameless');

-- Manual name: lives on own scans, carried forward on rescan, never in decks --

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');

update scans set deck_name = 'My Clone', name_source = 'manual' where deck_id = 'C-4WRXV-2W247-6QM7W';

select is(
  (select deck_name from record_scan('Box 2', 'C-4WRXV-2W247-6QM7W', null, 'C-4WRXV-2W247-6QM7W', null, now(), true)),
  'My Clone', 'rescan carries the manual name forward and returns it');

select pg_temp.logout();

select is((select name_source from scans where deck_id = 'C-4WRXV-2W247-6QM7W' order by created_at desc limit 1),
  'manual', 'carried-forward name keeps its manual provenance');
select is((select deck_name from decks where id = (select deck_ref from scans where deck_id = 'C-4WRXV-2W247-6QM7W' limit 1)),
  null, 'manual name never leaks into the shared decks row');
select is((select count(*)::int from scans where deck_id = 'C-4WRXV-2W247-6QM7W'), 2, 'two scans of the clone');

-- B scans the same clone code: per-user placeholder, untouched by A later -----

select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');
select lives_ok(
  $$ select * from record_scan('Shelf', 'C-4WRXV-2W247-6QM7W', null, 'C-4WRXV-2W247-6QM7W', null, now(), true) $$,
  'B can scan the same clone code');

-- RLS: B cannot rename A's scans
update scans set deck_name = 'hacked' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
select pg_temp.logout();
select is((select count(*)::int from scans where deck_name = 'hacked'), 0, 'RLS blocks renaming another user''s scans');

-- attach_scans_to_deck by Master Vault id -------------------------------------

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');

select throws_like(
  $$ select attach_scans_to_deck('C-4WRXV-2W247-6QM7W') $$,
  '%exactly one%', 'attach requires exactly one target (neither given)');
select throws_like(
  $$ select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', '11111111-1111-4111-8111-111111111111', null, null, '22222222-2222-4222-8222-222222222222') $$,
  '%exactly one%', 'attach requires exactly one target (both given)');
select throws_like(
  $$ select attach_scans_to_deck('NOTMY-DECKK-CODEE', '11111111-1111-4111-8111-111111111111') $$,
  '%No scans of%', 'attach refuses an identifier the caller never scanned');

select lives_ok(
  $$ select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', '11111111-1111-4111-8111-111111111111', 435, 'Lòrien il Puro') $$,
  'A attaches the clone to a Master Vault id');

select pg_temp.logout();

select is((select mv_status from decks where mv_id = '11111111-1111-4111-8111-111111111111'), 'unverified',
  'client-asserted MV id is created as unverified');
select is((select deck_name from decks where mv_id = '11111111-1111-4111-8111-111111111111'), 'Lòrien il Puro',
  'new canonical row takes the hydrated name');
select is(
  (select count(distinct deck_ref)::int from scans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = 'C-4WRXV-2W247-6QM7W'),
  1, 'all of A''s clone scans share one deck_ref');
select is(
  (select deck_ref from scans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = 'C-4WRXV-2W247-6QM7W' limit 1),
  (select id from decks where mv_id = '11111111-1111-4111-8111-111111111111'),
  'A''s clone scans point at the canonical row');
select isnt(
  (select deck_ref from scans where user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and deck_id = 'C-4WRXV-2W247-6QM7W'),
  (select id from decks where mv_id = '11111111-1111-4111-8111-111111111111'),
  'B''s scan of the same clone code is NOT repointed');
select is(
  (select count(*)::int from decks d where d.mv_id is null and not exists (select 1 from scans s where s.deck_ref = d.id)),
  0, 'A''s orphaned placeholder deck was removed');

-- The view now names the clone from the shared row and reports its state
select is((select deck_name from current_deck_locations where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = 'C-4WRXV-2W247-6QM7W'),
  'Lòrien il Puro', 'view shows the linked name for the clone');
select is((select is_clone from current_deck_locations where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = 'C-4WRXV-2W247-6QM7W'),
  true, 'view exposes is_clone');
select is((select mv_status from current_deck_locations where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = 'C-4WRXV-2W247-6QM7W'),
  'unverified', 'view exposes mv_status');

-- Clobber protection: a resolved canonical row is never overwritten ----------

insert into decks (id, mv_id, set_id, deck_name, mv_status)
values ('99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333', 1, 'Truth', 'resolved');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select is(
  (select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', '33333333-3333-4333-8333-333333333333', 999, 'Lie')),
  '99999999-9999-4999-8999-999999999999'::uuid, 're-attaching to an existing canonical row returns that row');
select pg_temp.logout();

select results_eq(
  $$ select deck_name, set_id, mv_status from decks where id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values ('Truth', 1, 'resolved') $$,
  'attach cannot overwrite a resolved row''s name, set_id, or status');
select ok(exists (select 1 from decks where mv_id = '11111111-1111-4111-8111-111111111111'),
  'previous canonical row (has mv_id) is kept, not deleted as an orphan');

-- An 'invalid' row that gets re-asserted goes back to 'unverified'
update decks set mv_status = 'invalid' where id = '99999999-9999-4999-8999-999999999999';
select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok(
  $$ select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', '33333333-3333-4333-8333-333333333333') $$,
  're-asserting an invalid id succeeds');
select pg_temp.logout();
select is((select mv_status from decks where id = '99999999-9999-4999-8999-999999999999'), 'unverified',
  're-asserted invalid id is queued for verification again');

-- link_deck_master_vault (client fast-path) follows the same rules ------------

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok(
  $$ select link_deck_master_vault(
       (select deck_ref from scans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = '3JV94-353M2-W5JX8' limit 1),
       '33333333-3333-4333-8333-333333333333', 999, 'Lie') $$,
  'client link onto an existing canonical row succeeds');
select pg_temp.logout();
select results_eq(
  $$ select deck_name, set_id from decks where id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values ('Truth', 1) $$,
  'client link cannot overwrite an existing row''s name or set_id');
select is(
  (select deck_ref from scans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = '3JV94-353M2-W5JX8' limit 1),
  '99999999-9999-4999-8999-999999999999'::uuid, 'client link repoints the caller''s original scans');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok(
  $$ select link_deck_master_vault(
       (select deck_ref from scans where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = '11111-22222-33333' limit 1),
       '44444444-4444-4444-8444-444444444444', 7, 'Old Client Deck') $$,
  'client link to a brand-new MV id succeeds');
select pg_temp.logout();
select is((select mv_status from decks where mv_id = '44444444-4444-4444-8444-444444444444'), 'unverified',
  'client-resolved MV id is unverified until the server confirms it');

-- attach by target deck in own collection -----------------------------------

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select throws_like(
  $$ select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', null, null, null,
       '55555555-5555-4555-8555-555555555555') $$,
  '%not in your collection%', 'cannot attach to a deck the caller has no scans of');
select is(
  (select attach_scans_to_deck('C-4WRXV-2W247-6QM7W', null, null, null, '99999999-9999-4999-8999-999999999999')),
  '99999999-9999-4999-8999-999999999999'::uuid, 'attach to an original already in the collection');
select pg_temp.logout();

select is(
  (select count(distinct deck_id)::int from current_deck_locations
     where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_ref = '99999999-9999-4999-8999-999999999999'),
  2, 'original and clone now appear as two copies of one deck');

-- Server verification -------------------------------------------------------

-- Queue hands out unverified rows once (stamps them), not the resolved one
select is(
  (select count(*)::int from decks_pending_verification(10)),
  3, 'verification queue claims every unverified deck');
select is(
  (select count(*)::int from decks_pending_verification(10)),
  0, 'claimed rows are not handed out again within the backoff');

select lives_ok(
  $$ select verify_deck_admin('99999999-9999-4999-8999-999999999999', true, 'Verified Truth', 2) $$,
  'admin verdict: valid');
select results_eq(
  $$ select deck_name, set_id, mv_status from decks where id = '99999999-9999-4999-8999-999999999999' $$,
  $$ values ('Verified Truth', 2, 'resolved') $$,
  'valid verdict overwrites name/set_id with API truth and resolves');

select lives_ok(
  $$ select verify_deck_admin((select id from decks where mv_id = '44444444-4444-4444-8444-444444444444'), false) $$,
  'admin verdict: invalid');
select is((select mv_status from decks where mv_id = '44444444-4444-4444-8444-444444444444'), 'invalid',
  'invalid verdict flags the row');

-- Name-search queue prefers a non-clone representative scan -----------------

update decks set mv_id = null, mv_status = 'pending', mv_lookup_at = null, deck_name = 'Lòrien il Puro'
  where id = '99999999-9999-4999-8999-999999999999';
select is(
  (select deck_code from decks_pending_resolution(10) where id = '99999999-9999-4999-8999-999999999999'),
  '3JV94-353M2-W5JX8', 'resolution queue reports the original''s code, not the clone''s');

select * from finish();
rollback;
