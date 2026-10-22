begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

create or replace function pg_temp.alice_removed(p_deck_id text) returns boolean language sql as $$
  select exists (
    select 1 from deck_removals
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deck_id = p_deck_id
  )
$$;

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select * from record_scan('Box 1', '3JV94-353M2-W5JX8', 'Lòrien il Puro', '3JV94-353M2-W5JX8', null, now(), false);
select * from record_scan('Box 1', 'C-4WRXV-2W247-6QM7W', null, 'C-4WRXV-2W247-6QM7W', null, now(), true);
select * from record_scan('Box 1', '11111-22222-33333', 'Sold Deck', '11111-22222-33333', null, now(), false);
select pg_temp.logout();

update scans set deck_ref = (select deck_ref from scans where deck_id = '3JV94-353M2-W5JX8' limit 1)
where deck_id = 'C-4WRXV-2W247-6QM7W';

select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');
select * from record_scan('Shelf', '11111-22222-33333', 'Sold Deck', '11111-22222-33333', null, now(), false);
select pg_temp.logout();

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');

select lives_ok(
  $$ insert into deck_removals (deck_id, note) values ('11111-22222-33333', 'Sold to Bob') $$,
  'a user can remove their own deck with a note');

select results_eq(
  $$ select removal_note, removed_at is not null from current_deck_locations where deck_id = '11111-22222-33333' $$,
  $$ values ('Sold to Bob', true) $$,
  'view exposes the removal note and date');

select is(
  (select count(*)::int from current_deck_locations where removed_at is null),
  2, 'removed deck is excluded when filtering on removed_at');

select throws_ok(
  $$ insert into deck_removals (user_id, deck_id) values ('bbbbbbbb-0000-4000-8000-000000000002', '11111-22222-33333') $$,
  '42501', null, 'RLS blocks removing a deck on another user''s behalf');

select pg_temp.logout();

select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');
select is(
  (select removed_at from current_deck_locations where deck_id = '11111-22222-33333'),
  null, 'another user''s removal does not affect B''s copy of the same deck');
select is((select count(*)::int from deck_removals), 0, 'B cannot see A''s removals');
select pg_temp.logout();

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select * from record_scan('Box 2', '11111-22222-33333', null, '11111-22222-33333', null, now(), false);
select pg_temp.logout();

select is(pg_temp.alice_removed('11111-22222-33333'), false, 'rescanning a removed deck clears its removal');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
insert into deck_removals (deck_id) values ('3JV94-353M2-W5JX8'), ('C-4WRXV-2W247-6QM7W');
select * from record_scan('Box 2', '3JV94-353M2-W5JX8', null, '3JV94-353M2-W5JX8', null, now(), false);
select pg_temp.logout();

select is(pg_temp.alice_removed('3JV94-353M2-W5JX8'), false, 'rescanning the original clears the original''s removal');
select is(pg_temp.alice_removed('C-4WRXV-2W247-6QM7W'), true, 'rescanning the original leaves its clone removed');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select * from record_scan('Box 2', 'C-4WRXV-2W247-6QM7W', null, 'C-4WRXV-2W247-6QM7W', null, now(), true);
select pg_temp.logout();

select is(pg_temp.alice_removed('C-4WRXV-2W247-6QM7W'), false, 'rescanning a clone clears the clone''s removal');

update scans set deck_ref = (select deck_ref from scans where deck_id = '3JV94-353M2-W5JX8' limit 1)
where deck_id = '11111-22222-33333' and user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
insert into deck_removals (deck_id) values ('11111-22222-33333');
select * from record_scan('Box 3', '3JV94-353M2-W5JX8', null, '3JV94-353M2-W5JX8', null, now(), false);
select pg_temp.logout();

select is(pg_temp.alice_removed('11111-22222-33333'), false,
  'rescanning an original clears removals on its other identifier forms');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
insert into deck_removals (deck_id, note) values ('3JV94-353M2-W5JX8', 'Traded');
select lives_ok(
  $$ delete from deck_removals where deck_id = '3JV94-353M2-W5JX8' $$,
  'a user can restore their own removed deck');
select pg_temp.logout();

select is(pg_temp.alice_removed('3JV94-353M2-W5JX8'), false, 'restore clears the removal');

insert into decks (id, deck_name) values ('77777777-7777-4777-8777-777777777777', 'Shared Placeholder');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select * from record_scan('Box 9', 'ZZZZZ-ZZZZZ-ZZZZZ', 'Doomed Deck', 'ZZZZZ-ZZZZZ-ZZZZZ', null, now(), false);
insert into deck_notes (deck_id, content) values ('ZZZZZ-ZZZZZ-ZZZZZ', 'Gone soon');
insert into deck_removals (deck_id, note) values ('ZZZZZ-ZZZZZ-ZZZZZ', 'Gave it away');
select pg_temp.logout();

create temp table doomed as
select distinct deck_ref from scans where deck_id = 'ZZZZZ-ZZZZZ-ZZZZZ';

select pg_temp.login('bbbbbbbb-0000-4000-8000-000000000002');
select lives_ok(
  $$ select delete_deck_copy(array['ZZZZZ-ZZZZZ-ZZZZZ']) $$,
  'deleting a deck that is not yours is a harmless no-op');
select pg_temp.logout();

select is((select count(*)::int from scans where deck_id = 'ZZZZZ-ZZZZZ-ZZZZZ'), 1,
  'another user cannot delete A''s scans');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select lives_ok(
  $$ select delete_deck_copy(array['ZZZZZ-ZZZZZ-ZZZZZ']) $$,
  'A permanently deletes the deck');
select pg_temp.logout();

select is((select count(*)::int from scans where deck_id = 'ZZZZZ-ZZZZZ-ZZZZZ'), 0, 'its scans are deleted');
select is((select count(*)::int from deck_notes where deck_id = 'ZZZZZ-ZZZZZ-ZZZZZ'), 0, 'its notes are deleted');
select is((select count(*)::int from deck_removals where deck_id = 'ZZZZZ-ZZZZZ-ZZZZZ'), 0, 'its removal is deleted');
select is((select count(*)::int from decks where id in (select deck_ref from doomed)), 0,
  'its orphaned placeholder deck is deleted');
select ok(exists (select 1 from decks where id = '77777777-7777-4777-8777-777777777777'),
  'unrelated placeholder decks are untouched');

select pg_temp.login('aaaaaaaa-0000-4000-8000-000000000001');
select * from delete_deck_copy(array['C-4WRXV-2W247-6QM7W']);
select pg_temp.logout();

select is((select count(*)::int from scans where deck_id = 'C-4WRXV-2W247-6QM7W'), 0, 'deleting a clone removes its scans');
select ok(
  (select count(*) > 0 from scans where deck_id = '3JV94-353M2-W5JX8'),
  'deleting a clone leaves the original in place');
select is(
  (select count(*)::int from scans where deck_id = '11111-22222-33333' and user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  1, 'other users'' copies of the same deck are untouched');

select * from finish();
rollback;
