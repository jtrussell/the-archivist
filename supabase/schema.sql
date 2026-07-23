-- The Archivist — Supabase schema
-- Paste this whole file into the Supabase SQL Editor and run it once.

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
  deck_id    text not null,        -- canonical scanned ID: MV uuid if QR was a URL, else uppercased deck code
  deck_code  text,                 -- e.g. 4Q958-HX64G-JH6P9 (when scanned as code)
  deck_uuid  uuid,                 -- keyforgegame.com master-vault uuid (when scanned as URL)
  deck_name  text,                 -- nullable; name fetch may fail offline
  mv_id      uuid,                 -- master-vault deck id (differs from the scanned QR id); looked up lazily by name
  set_id     integer,              -- master-vault expansion set id
  position   integer not null,     -- per-user, per-label incrementing counter
  scanned_at timestamptz not null, -- client-side time of scan (accurate for offline scans)
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

-- Atomic scan recording: the label upsert row-locks the label, serializing
-- max(position)+1 per (user, label); returns the assigned position for the UI.
create or replace function public.record_scan(
  p_label      text,
  p_deck_id    text,
  p_deck_name  text default null,
  p_deck_code  text default null,
  p_deck_uuid  uuid default null,
  p_scanned_at timestamptz default now()
) returns table (scan_id uuid, label_id uuid, "position" integer)
language plpgsql security invoker set search_path = public
as $$
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
end $$;

revoke execute on function public.record_scan from anon;

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

-- Current location per deck (most recent scan wins); security_invoker so RLS applies.
create or replace view public.current_deck_locations
with (security_invoker = true) as
select distinct on (s.user_id, s.deck_id)
  s.id as scan_id, s.user_id, s.deck_id, s.deck_name, s.deck_code, s.deck_uuid,
  s.mv_id, s.set_id,
  l.name as label, s.position, s.scanned_at, s.created_at
from public.scans s
join public.labels l on l.id = s.label_id
order by s.user_id, s.deck_id, s.created_at desc;
