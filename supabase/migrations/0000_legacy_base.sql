-- Migration 0000 — legacy base schema (LOCAL REPLAY ONLY)
--
-- The production database was created from an early schema.sql by hand, and
-- migrations 0001+ were written against that live state. This file recreates
-- that pre-migration schema so the whole chain can replay from scratch on a
-- fresh local database (`supabase start` / `supabase db reset`), which is what
-- the pgTAP tests in supabase/tests run against.
--
-- It is a no-op when the tables already exist, so it is harmless if it is ever
-- pushed to production — but it is not needed there and should not be run via
-- the SQL editor.

do $base$
begin
  if to_regclass('public.scans') is not null then
    raise notice 'legacy base schema already present; skipping';
    return;
  end if;

  create table public.labels (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    name       text not null check (length(trim(name)) > 0),
    created_at timestamptz not null default now(),
    unique (user_id, name)
  );

  create table public.scans (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    label_id   uuid not null references public.labels(id) on delete cascade,
    deck_id    text not null,
    deck_code  text,
    deck_uuid  uuid,
    deck_name  text,
    mv_id      uuid,
    set_id     integer,
    position   integer not null,
    scanned_at timestamptz not null,
    created_at timestamptz not null default now()
  );

  create index scans_label_position_idx on public.scans (label_id, position desc);
  create index scans_user_deck_recent_idx on public.scans (user_id, deck_id, created_at desc);

  create table public.deck_notes (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
    deck_id    text not null,
    content    text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, deck_id)
  );

  alter table public.labels enable row level security;
  alter table public.scans  enable row level security;
  alter table public.deck_notes enable row level security;

  create policy "own labels select" on public.labels for select using (user_id = auth.uid());
  create policy "own labels insert" on public.labels for insert with check (user_id = auth.uid());
  create policy "own labels update" on public.labels for update using (user_id = auth.uid());
  create policy "own scans select"  on public.scans  for select using (user_id = auth.uid());
  create policy "own scans insert"  on public.scans  for insert with check (user_id = auth.uid());
  create policy "own scans update"  on public.scans  for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy "own notes select" on public.deck_notes for select using (user_id = auth.uid());
  create policy "own notes insert" on public.deck_notes for insert with check (user_id = auth.uid());
  create policy "own notes update" on public.deck_notes for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy "own notes delete" on public.deck_notes for delete using (user_id = auth.uid());

  create function public.record_scan(
    p_label      text,
    p_deck_id    text,
    p_deck_name  text default null,
    p_deck_code  text default null,
    p_deck_uuid  uuid default null,
    p_scanned_at timestamptz default now()
  ) returns table (scan_id uuid, label_id uuid, "position" integer)
  language plpgsql security invoker set search_path = public
  as $fn$
  declare
    v_label_id uuid;
    v_pos      integer;
    v_scan_id  uuid;
  begin
    insert into labels (user_id, name)
    values (auth.uid(), trim(p_label))
    on conflict (user_id, name) do update set name = excluded.name
    returning id into v_label_id;

    select coalesce(max(s.position), 0) + 1 into v_pos
    from scans s where s.label_id = v_label_id;

    insert into scans (user_id, label_id, deck_id, deck_code, deck_uuid, deck_name, position, scanned_at)
    values (auth.uid(), v_label_id, p_deck_id, p_deck_code, p_deck_uuid, p_deck_name, v_pos, p_scanned_at)
    returning id into v_scan_id;

    return query select v_scan_id, v_label_id, v_pos;
  end $fn$;

  revoke execute on function public.record_scan(text, text, text, text, uuid, timestamptz) from anon;

  create function public.delete_account()
  returns void
  language plpgsql security definer set search_path = public
  as $fn$
  begin
    if auth.uid() is null then
      raise exception 'Not authenticated';
    end if;
    delete from auth.users where id = auth.uid();
  end $fn$;

  revoke execute on function public.delete_account from anon, public;
  grant execute on function public.delete_account to authenticated;

  create view public.current_deck_locations
  with (security_invoker = true) as
  select distinct on (s.user_id, s.deck_id)
    s.id as scan_id, s.user_id, s.deck_id, s.deck_name, s.deck_code, s.deck_uuid,
    s.mv_id, s.set_id,
    l.name as label, s.position, s.scanned_at, s.created_at
  from public.scans s
  join public.labels l on l.id = s.label_id
  order by s.user_id, s.deck_id, s.created_at desc;
end $base$;
