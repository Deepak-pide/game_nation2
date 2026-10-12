set search_path = public, extensions;

create table if not exists public.quick_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.availability_slots(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  players smallint not null check (players in (1, 2, 3)),
  total_price numeric(10, 2) not null default 0 check (total_price >= 0),
  created_at timestamptz not null default now()
);

alter table public.quick_bookings
  add column if not exists total_price numeric(10, 2) not null default 0;
update public.quick_bookings
   set total_price = players * 20
 where total_price = 0;
alter table public.quick_bookings
  drop constraint if exists quick_bookings_total_price_check;
alter table public.quick_bookings
  add constraint quick_bookings_total_price_check check (total_price >= 0);

alter table public.quick_bookings enable row level security;

drop policy if exists quick_bookings_admin_read on public.quick_bookings;
create policy quick_bookings_admin_read on public.quick_bookings
  for select to authenticated using (public.is_admin());

grant select on public.quick_bookings to authenticated;

create or replace function public.create_quick_booking(p_slot_id uuid, p_name text, p_players integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_slot public.availability_slots;
  console_is_active boolean;
  created_id uuid;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Enter a name up to 80 characters';
  end if;
  if p_players is null or p_players not in (1, 2, 3) then
    raise exception 'Choose 1, 2, or 3 players';
  end if;

  select slot.*
    into target_slot
    from public.availability_slots slot
   where slot.id = p_slot_id
   for update of slot;

  if not found or not target_slot.available then
    raise exception 'That slot is no longer available';
  end if;
  select console.active into console_is_active
    from public.consoles console
   where console.id = target_slot.console_id;
  if not coalesce(console_is_active, false) then
    raise exception 'That console is no longer available';
  end if;
  if target_slot.starts_at <= now() then
    raise exception 'Cannot book a session that has already started';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_slot.console_id::text, 0));

  if exists (
    select 1
      from public.bookings booking
     where booking.console_id = target_slot.console_id
       and booking.status in ('pending', 'approved', 'completed')
       and booking.starts_at < target_slot.ends_at
       and booking.ends_at > target_slot.starts_at
  ) or exists (
    select 1
      from public.quick_bookings quick
      join public.availability_slots booked_slot on booked_slot.id = quick.slot_id
     where booked_slot.console_id = target_slot.console_id
       and booked_slot.starts_at < target_slot.ends_at
       and booked_slot.ends_at > target_slot.starts_at
  ) then
    raise exception 'That slot is already booked or awaiting admin approval';
  end if;

  insert into public.quick_bookings (slot_id, name, players, total_price)
  values (target_slot.id, btrim(p_name), p_players, p_players * 20)
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.quick_booked_console_slots(
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
  select slot.starts_at, slot.ends_at
    from public.quick_bookings quick
    join public.availability_slots slot on slot.id = quick.slot_id
   where slot.console_id = p_console_id
     and slot.starts_at < p_ends_at
     and slot.ends_at > p_starts_at;
$$;

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

  select slot.available, console.hourly_rate
    into slot_available, rate
    from public.availability_slots slot
    join public.consoles console on console.id = slot.console_id and console.active
   where slot.console_id = new.console_id
     and slot.starts_at = new.starts_at
     and slot.ends_at = new.ends_at
   for update of slot;

  if not found or not slot_available then
    raise exception 'That console and time is not available';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.console_id::text, 0));

  if exists (
    select 1
      from public.quick_bookings quick
      join public.availability_slots slot on slot.id = quick.slot_id
     where slot.console_id = new.console_id
       and slot.starts_at < new.ends_at
       and slot.ends_at > new.starts_at
  ) then
    raise exception 'That slot has already been quick booked';
  end if;

  new.total_price := rate * extract(epoch from (new.ends_at - new.starts_at)) / 3600;
  return new;
end;
$$;

revoke all on function public.create_quick_booking(uuid, text, integer) from public;
revoke all on function public.quick_booked_console_slots(uuid, timestamptz, timestamptz) from public;
grant execute on function public.create_quick_booking(uuid, text, integer) to anon, authenticated;
grant execute on function public.quick_booked_console_slots(uuid, timestamptz, timestamptz) to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.quick_bookings;
exception when duplicate_object or undefined_object then
  null;
end;
$$;
