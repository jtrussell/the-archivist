-- Migration 0005 — Deck removals (soft delete) and permanent copy deletion
--
-- Additive and backward compatible: the view only appends columns and
-- record_scan keeps its signature. Apply BEFORE deploying the client.

begin;

create table if not exists public.deck_removals (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id    text not null,
  note       text,
  removed_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);

alter table public.deck_removals enable row level security;

create policy "own removals select" on public.deck_removals for select using (user_id = auth.uid());
create policy "own removals insert" on public.deck_removals for insert with check (user_id = auth.uid());
create policy "own removals update" on public.deck_removals for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own removals delete" on public.deck_removals for delete using (user_id = auth.uid());

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
    update decks d set deck_name = coalesce(d.deck_name, p_deck_name), updated_at = now()
    where d.id = v_deck_ref and d.deck_name is null;
  end if;

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

commit;
