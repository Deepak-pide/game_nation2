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
