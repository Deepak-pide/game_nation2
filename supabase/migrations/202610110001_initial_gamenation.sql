create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  game_id text not null unique default ('GN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'gamer' check (role in ('admin', 'gamer')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text not null default '';

create table if not exists public.consoles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  platform text not null default 'PlayStation',
  hourly_rate numeric(10, 2) not null check (hourly_rate >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  console_id uuid not null references public.consoles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  constraint availability_slot_duration check (ends_at > starts_at),
  constraint availability_slot_unique unique (console_id, starts_at, ends_at)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  console_id uuid not null references public.consoles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'completed')),
  total_price numeric(10, 2) not null default 0 check (total_price >= 0),
  gamer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_duration check (ends_at > starts_at),
  constraint approved_booking_no_overlap exclude using gist (
    console_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('approved', 'completed'))
);

create table if not exists public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  created_at timestamptz not null default now()
);

create index if not exists bookings_user_start_idx on public.bookings (user_id, starts_at desc);
create index if not exists bookings_console_start_idx on public.bookings (console_id, starts_at);
create index if not exists availability_console_start_idx on public.availability_slots (console_id, starts_at);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.email_confirmed_at is not null and lower(new.email) = 'dg3667610@gmail.com' then 'admin' else 'gamer' end
  )
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_user();

drop trigger if exists on_auth_user_changed_profile on auth.users;
create trigger on_auth_user_changed_profile
  after update of email, email_confirmed_at on auth.users
  for each row execute function public.create_profile_for_user();

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and current_user <> 'postgres' then
    raise exception 'Profile roles can only be changed by a trusted database operator';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_role_is_trusted on public.profiles;
create trigger profile_role_is_trusted
  before update of role on public.profiles
  for each row execute function public.protect_profile_role();

create or replace function public.prepare_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  slot_available boolean;
  rate numeric(10, 2);
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Booking requests must be made by a signed-in gamer';
  end if;
  if new.starts_at <= now() then
    raise exception 'Cannot request a session in the past';
  end if;

  new.user_id := auth.uid();
  new.status := 'pending';
  new.updated_at := now();

  select a.available, c.hourly_rate
    into slot_available, rate
    from public.availability_slots a
    join public.consoles c on c.id = a.console_id and c.active
   where a.console_id = new.console_id
     and a.starts_at = new.starts_at
     and a.ends_at = new.ends_at;

  if not found or not slot_available then
    raise exception 'That console and time is not available';
  end if;

  new.total_price := rate * extract(epoch from (new.ends_at - new.starts_at)) / 3600;
  return new;
end;
$$;

drop trigger if exists booking_request_is_server_priced on public.bookings;
create trigger booking_request_is_server_priced
  before insert on public.bookings
  for each row execute function public.prepare_booking();

create or replace function public.record_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into public.booking_events (booking_id, changed_by, old_status, new_status)
    values (new.id, auth.uid(), old.status, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists booking_status_audit on public.bookings;
create trigger booking_status_audit
  before update on public.bookings
  for each row execute function public.record_booking_status_change();

create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_booking public.bookings;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_status not in ('approved', 'rejected', 'cancelled', 'completed') then
    raise exception 'Invalid booking status';
  end if;

  select * into updated_booking
    from public.bookings
   where id = p_booking_id
   for update;
  if not found then
    raise exception 'Booking not found';
  end if;
  if not (
    (updated_booking.status = 'pending' and p_status in ('approved', 'rejected', 'cancelled'))
    or (updated_booking.status = 'approved' and p_status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid booking status transition';
  end if;

  update public.bookings
     set status = p_status
   where id = p_booking_id
   returning * into updated_booking;
  return updated_booking;
end;
$$;

create or replace function public.cancel_own_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_booking public.bookings;
begin
  update public.bookings
     set status = 'cancelled'
   where id = p_booking_id
     and user_id = auth.uid()
     and status in ('pending', 'approved')
   returning * into updated_booking;
  if not found then
    raise exception 'This booking cannot be cancelled';
  end if;
  return updated_booking;
end;
$$;

create or replace function public.confirmed_console_slots(
  p_console_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.starts_at, b.ends_at
    from public.bookings b
   where b.console_id = p_console_id
     and b.status in ('approved', 'completed')
     and b.starts_at < p_ends_at
     and b.ends_at > p_starts_at;
$$;

revoke all on function public.admin_set_booking_status(uuid, text) from public;
revoke all on function public.cancel_own_booking(uuid) from public;
revoke all on function public.confirmed_console_slots(uuid, timestamptz, timestamptz) from public;
grant execute on function public.admin_set_booking_status(uuid, text) to authenticated;
grant execute on function public.cancel_own_booking(uuid) to authenticated;
grant execute on function public.confirmed_console_slots(uuid, timestamptz, timestamptz) to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.consoles enable row level security;
alter table public.availability_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_admin());
drop policy if exists profiles_update_own_or_admin on public.profiles;
create policy profiles_update_own_or_admin on public.profiles
  for update to authenticated using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

drop policy if exists consoles_read_active_or_admin on public.consoles;
create policy consoles_read_active_or_admin on public.consoles
  for select to anon, authenticated using (active);
drop policy if exists consoles_admin_manage on public.consoles;
create policy consoles_admin_manage on public.consoles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists availability_read_authenticated on public.availability_slots;
create policy availability_read_authenticated on public.availability_slots
  for select to anon, authenticated using (available);
drop policy if exists availability_admin_manage on public.availability_slots;
create policy availability_admin_manage on public.availability_slots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bookings_read_own_or_admin on public.bookings;
create policy bookings_read_own_or_admin on public.bookings
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists bookings_request_own on public.bookings;
create policy bookings_request_own on public.bookings
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');

drop policy if exists booking_events_read_own_or_admin on public.booking_events;
create policy booking_events_read_own_or_admin on public.booking_events
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.user_id = (select auth.uid())
    )
  );

grant select on public.profiles, public.consoles, public.availability_slots, public.bookings, public.booking_events to authenticated;
grant select on public.consoles, public.availability_slots to anon;
grant update (full_name, phone) on public.profiles to authenticated;
grant insert (console_id, starts_at, ends_at, gamer_note) on public.bookings to authenticated;
grant select, insert, update, delete on public.consoles, public.availability_slots to authenticated;
grant usage, select on sequence public.booking_events_id_seq to authenticated;

alter table public.bookings replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object or undefined_object then
  null;
end;
$$;

insert into public.consoles (name, platform, hourly_rate)
values ('PlayStation 5 - 01', 'PlayStation 5', 80), ('PlayStation 5 - 02', 'PlayStation 5', 80)
on conflict (name) do nothing;

insert into public.profiles (id, email, full_name, role)
select u.id, coalesce(u.email, ''), coalesce(u.raw_user_meta_data ->> 'full_name', ''),
       case when u.email_confirmed_at is not null and lower(u.email) = 'dg3667610@gmail.com' then 'admin' else 'gamer' end
  from auth.users u
on conflict (id) do update
  set email = excluded.email,
      role = excluded.role;

alter table public.profiles
  add column if not exists game_tags text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_game_tags_check'
  ) then
    alter table public.profiles
      add constraint profiles_game_tags_check
      check (
        cardinality(game_tags) <= 5
        and game_tags <@ array['fps', 'sports', 'battle-royale', 'racing', 'rpg', 'fighting', 'strategy']::text[]
      );
  end if;
end;
$$;

grant update (full_name, phone, game_tags) on public.profiles to authenticated;

create or replace function public.get_gamer_leaderboard(p_sort text default 'most_played')
returns table (
  rank bigint,
  game_id text,
  full_name text,
  game_tags text[],
  is_current_user boolean,
  completed_sessions bigint,
  total_bookings bigint,
  playtime_hours numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view player rankings';
  end if;
  if p_sort not in ('most_played', 'most_bookings', 'most_hours') then
    raise exception 'Invalid ranking filter';
  end if;

  return query
  with gamer_stats as (
    select
      p.game_id,
      p.full_name,
      p.game_tags,
      p.id = auth.uid() as is_current_user,
      (count(b.id) filter (where b.status = 'completed'))::bigint as completed_sessions,
      count(b.id)::bigint as total_bookings,
      round(coalesce(sum(extract(epoch from (b.ends_at - b.starts_at)) / 3600)
        filter (where b.status = 'completed'), 0)::numeric, 1) as playtime_hours
    from public.profiles p
    left join public.bookings b on b.user_id = p.id
    where p.role = 'gamer'
    group by p.id, p.game_id, p.full_name, p.game_tags
  ),
  ranked_gamers as (
    select
      row_number() over (
        order by
          case when p_sort = 'most_played' then gs.completed_sessions end desc nulls last,
          case when p_sort = 'most_bookings' then gs.total_bookings end desc nulls last,
          case when p_sort = 'most_hours' then gs.playtime_hours end desc nulls last,
          gs.game_id
      ) as placement,
      gs.*
    from gamer_stats gs
    where gs.total_bookings > 0 or gs.is_current_user
  )
  select
    rg.placement,
    rg.game_id,
    rg.full_name,
    rg.game_tags,
    rg.is_current_user,
    rg.completed_sessions,
    rg.total_bookings,
    rg.playtime_hours
  from ranked_gamers rg
  where rg.placement <= 100 or rg.is_current_user
  order by rg.placement
  limit 101;
end;
$$;

revoke all on function public.get_gamer_leaderboard(text) from public, anon;
grant execute on function public.get_gamer_leaderboard(text) to authenticated;