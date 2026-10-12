revoke all on function public.create_quick_booking(uuid, text, integer) from public, anon, authenticated;

create or replace function public.admin_create_quick_booking(p_slot_id uuid, p_name text, p_players integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return public.create_quick_booking(p_slot_id, p_name, p_players);
end;
$$;

revoke all on function public.admin_create_quick_booking(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.admin_create_quick_booking(uuid, text, integer) to authenticated;
