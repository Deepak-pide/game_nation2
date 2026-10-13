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
    raise exception 'Bookings must be made by a signed-in gamer';
  end if;
  if new.starts_at <= now() then
    raise exception 'Cannot book a session in the past';
  end if;

  new.user_id := auth.uid();
  new.status := 'approved';
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
      from public.bookings booking
     where booking.console_id = new.console_id
       and booking.status in ('pending', 'approved', 'completed')
       and booking.starts_at < new.ends_at
       and booking.ends_at > new.starts_at
  ) or exists (
    select 1
      from public.quick_bookings quick
      join public.availability_slots booked_slot on booked_slot.id = quick.slot_id
     where booked_slot.console_id = new.console_id
       and booked_slot.starts_at < new.ends_at
       and booked_slot.ends_at > new.starts_at
  ) then
    raise exception 'That slot is already booked';
  end if;

  new.total_price := rate * extract(epoch from (new.ends_at - new.starts_at)) / 3600;
  return new;
end;
$$;

drop policy if exists bookings_request_own on public.bookings;
create policy bookings_request_own on public.bookings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'approved');

create or replace function public.charge_instant_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_balance numeric(10, 2);
begin
  if new.total_price > 0 then
    perform 1 from public.profiles where id = new.user_id for update;
    select coalesce(sum(amount), 0)::numeric(10, 2)
      into wallet_balance
      from public.wallet_transactions
     where user_id = new.user_id;

    if wallet_balance < new.total_price then
      raise exception 'Insufficient wallet credit. Add credit before booking this slot.';
    end if;

    insert into public.wallet_transactions (user_id, booking_id, amount, transaction_type, note, created_by)
    values (new.user_id, new.id, -new.total_price, 'booking_charge', 'Booking confirmed', auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists booking_charge_on_insert on public.bookings;
create trigger booking_charge_on_insert
  after insert on public.bookings
  for each row execute function public.charge_instant_booking();
revoke all on function public.charge_instant_booking() from public;

alter table public.live_sessions alter column booking_id drop not null;
alter table public.live_sessions drop constraint if exists live_sessions_booking_id_fkey;
alter table public.live_sessions
  add constraint live_sessions_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete set null;

create or replace function public.admin_delete_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into target_booking
    from public.bookings
   where id = p_booking_id
   for update;
  if not found then
    raise exception 'Booking not found';
  end if;

  if target_booking.status = 'approved' and not exists (
    select 1 from public.live_sessions where booking_id = p_booking_id
  ) then
    update public.bookings set status = 'cancelled' where id = p_booking_id;
  end if;
  delete from public.bookings where id = p_booking_id;
end;
$$;

revoke all on function public.admin_delete_booking(uuid) from public, anon;
grant execute on function public.admin_delete_booking(uuid) to authenticated;

create or replace function public.admin_delete_quick_booking(p_quick_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  select id into target_booking_id
    from public.quick_bookings
   where id = p_quick_booking_id
   for update;
  if not found then
    raise exception 'Guest booking not found';
  end if;

  delete from public.admin_wallet_transactions
   where quick_booking_id = p_quick_booking_id;
  delete from public.quick_bookings where id = p_quick_booking_id;
end;
$$;

revoke all on function public.admin_delete_quick_booking(uuid) from public, anon;
grant execute on function public.admin_delete_quick_booking(uuid) to authenticated;

create or replace function public.guest_create_quick_booking(
  p_slot_id uuid,
  p_name text,
  p_players integer
)
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
  if auth.uid() is not null and public.is_admin() then
    raise exception 'Use the admin Quick Start for administrator bookings';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Enter a name up to 80 characters';
  end if;
  if p_players is null or p_players not in (1, 2, 3) then
    raise exception 'Choose 1, 2, or 3 players';
  end if;

  select slot.* into target_slot
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
    raise exception 'That slot is already booked';
  end if;

  insert into public.quick_bookings (slot_id, name, players, total_price)
  values (target_slot.id, btrim(p_name), p_players, p_players * 20)
  returning id into created_id;
  return created_id;
end;
$$;

revoke all on function public.guest_create_quick_booking(uuid, text, integer) from public;
grant execute on function public.guest_create_quick_booking(uuid, text, integer) to anon, authenticated;
grant execute on function public.guest_list_quick_booking_slots(timestamptz, timestamptz) to anon, authenticated;
