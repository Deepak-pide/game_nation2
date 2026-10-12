create or replace function public.admin_delete_gamer(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'gamer'
    for update
  ) then
    raise exception 'Gamer account not found';
  end if;
  if exists (
    select 1 from public.live_sessions
    where user_id = p_user_id and status in ('running', 'paused')
  ) then
    raise exception 'Stop the gamer live session before deleting this account';
  end if;

  delete from public.tournament_match_results
  where winner_id = p_user_id
     or changed_by = p_user_id
     or match_id in (
       select id from public.tournament_matches
       where player_a_id = p_user_id or player_b_id = p_user_id or winner_id = p_user_id
     );

  delete from public.tournament_points_transactions
  where user_id = p_user_id
     or created_by = p_user_id
     or match_id in (
       select id from public.tournament_matches
       where player_a_id = p_user_id or player_b_id = p_user_id or winner_id = p_user_id
     );

  update public.tournament_matches
  set player_a_id = case when player_a_id = p_user_id then null else player_a_id end,
      player_b_id = case when player_b_id = p_user_id then null else player_b_id end,
      score_a = null,
      score_b = null,
      winner_id = null,
      status = 'scheduled',
      result_confirmed_at = null,
      updated_at = now()
  where player_a_id = p_user_id or player_b_id = p_user_id or winner_id = p_user_id;

  delete from public.wallet_transactions
  where user_id = p_user_id
     or live_session_id in (
       select id from public.live_sessions where user_id = p_user_id
     );

  delete from public.live_sessions where user_id = p_user_id;

  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'Could not delete gamer authentication account';
  end if;
end;
$$;

revoke all on function public.admin_delete_gamer(uuid) from public;
grant execute on function public.admin_delete_gamer(uuid) to authenticated;
