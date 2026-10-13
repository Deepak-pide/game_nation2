drop function if exists public.guest_list_quick_booking_slots(timestamptz, timestamptz);

create function public.guest_list_quick_booking_slots(
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (
  id uuid,
  console_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  available boolean,
  booked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with slot_states as (
    select
      slot.id,
      console.name as console_name,
      slot.starts_at,
      slot.ends_at,
      slot.available,
      exists (
        select 1
          from public.bookings booking
         where booking.console_id = slot.console_id
           and booking.status in ('pending', 'approved', 'completed')
           and booking.starts_at < slot.ends_at
           and booking.ends_at > slot.starts_at
      ) or exists (
        select 1
          from public.quick_bookings quick
          join public.availability_slots booked_slot on booked_slot.id = quick.slot_id
         where booked_slot.console_id = slot.console_id
           and booked_slot.starts_at < slot.ends_at
           and booked_slot.ends_at > slot.starts_at
      ) as booked
      from public.availability_slots slot
      join public.consoles console on console.id = slot.console_id and console.active
     where slot.starts_at > now()
       and slot.starts_at < p_ends_at
       and slot.ends_at > p_starts_at
  )
  select id, console_name, starts_at, ends_at, available, booked
    from slot_states
   where available or booked
   order by starts_at, console_name;
$$;

revoke all on function public.guest_list_quick_booking_slots(timestamptz, timestamptz) from public;
grant execute on function public.guest_list_quick_booking_slots(timestamptz, timestamptz) to anon, authenticated;
