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

revoke all on function public.guest_create_quick_booking(uuid, text, integer) from public;
grant execute on function public.guest_create_quick_booking(uuid, text, integer) to anon, authenticated;
