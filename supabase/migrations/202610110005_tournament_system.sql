create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  game text not null check (length(trim(game)) between 1 and 80),
  description text not null default '',
  tournament_at timestamptz not null,
  registration_deadline timestamptz not null,
  max_players integer not null check (max_players between 2 and 512),
  rules text not null default '',
  entry_details text not null default 'Free entry',
  prize_details text not null default 'Tournament points',
  points_per_win integer not null default 10 check (points_per_win >= 0),
  status text not null default 'created'
    check (status in ('created', 'registration_open', 'registration_closed', 'bracket_ready', 'live', 'completed', 'cancelled')),
  featured boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_deadline_before_start check (registration_deadline <= tournament_at)
);

create table if not exists public.tournament_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered', 'withdrawn')),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_registration_once unique (tournament_id, user_id)
);

create table if not exists public.tournament_rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  name text not null,
  created_at timestamptz not null default now(),
  constraint tournament_round_once unique (tournament_id, round_number),
  constraint tournament_round_id_tournament unique (id, tournament_id)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_id uuid not null,
  match_number integer not null check (match_number > 0),
  player_a_id uuid references public.profiles(id) on delete set null,
  player_b_id uuid references public.profiles(id) on delete set null,
  score_a integer check (score_a >= 0),
  score_b integer check (score_b >= 0),
  winner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'bye')),
  result_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_match_round_fk foreign key (round_id, tournament_id)
    references public.tournament_rounds(id, tournament_id) on delete cascade,
  constraint tournament_match_position_once unique (round_id, match_number),
  constraint tournament_match_distinct_players check (player_a_id is null or player_b_id is null or player_a_id <> player_b_id),
  constraint tournament_match_winner_is_player check (winner_id is null or winner_id in (player_a_id, player_b_id))
);

create table if not exists public.tournament_match_results (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  result_version integer not null check (result_version > 0),
  changed_by uuid not null references public.profiles(id),
  score_a integer not null check (score_a >= 0),
  score_b integer not null check (score_b >= 0),
  winner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint tournament_match_result_version_once unique (match_id, result_version)
);

create table if not exists public.tournament_points_transactions (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  result_version integer not null check (result_version > 0),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('award', 'reversal')),
  points integer not null check (points <> 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint tournament_points_event_once unique (match_id, result_version, user_id, transaction_type)
);

create index if not exists tournament_status_date_idx on public.tournaments (status, tournament_at);
create index if not exists tournament_registration_users_idx on public.tournament_registrations (user_id, status);
create index if not exists tournament_matches_tournament_idx on public.tournament_matches (tournament_id, round_id, match_number);
create index if not exists tournament_points_users_idx on public.tournament_points_transactions (user_id, created_at desc);

alter table public.tournaments enable row level security;
alter table public.tournament_registrations enable row level security;
alter table public.tournament_rounds enable row level security;
alter table public.tournament_matches enable row level security;
alter table public.tournament_match_results enable row level security;
alter table public.tournament_points_transactions enable row level security;

drop policy if exists tournament_public_read on public.tournaments;
create policy tournament_public_read on public.tournaments
  for select to anon, authenticated using (true);
drop policy if exists tournament_registration_public_read on public.tournament_registrations;
drop policy if exists tournament_round_public_read on public.tournament_rounds;
drop policy if exists tournament_match_public_read on public.tournament_matches;
drop policy if exists tournament_match_results_admin_read on public.tournament_match_results;
create policy tournament_match_results_admin_read on public.tournament_match_results
  for select to authenticated using (public.is_admin());
drop policy if exists tournament_points_admin_read on public.tournament_points_transactions;
create policy tournament_points_admin_read on public.tournament_points_transactions
  for select to authenticated using (public.is_admin());

revoke all on public.tournament_registrations, public.tournament_rounds, public.tournament_matches from public, anon, authenticated;
revoke all on public.tournament_match_results, public.tournament_points_transactions from public, anon, authenticated;
grant select on public.tournaments to anon, authenticated;
grant select on public.tournament_match_results, public.tournament_points_transactions to authenticated;

create or replace function public.touch_tournament_for_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_tournament uuid;
begin
  if tg_op = 'DELETE' then
    affected_tournament := old.tournament_id;
  else
    affected_tournament := new.tournament_id;
  end if;
  update public.tournaments set updated_at = now() where id = affected_tournament;
  return null;
end;
$$;

drop trigger if exists tournament_registration_realtime on public.tournament_registrations;
create trigger tournament_registration_realtime
  after insert or update or delete on public.tournament_registrations
  for each row execute function public.touch_tournament_for_realtime();
drop trigger if exists tournament_match_realtime on public.tournament_matches;
create trigger tournament_match_realtime
  after insert or update or delete on public.tournament_matches
  for each row execute function public.touch_tournament_for_realtime();
create or replace function public.get_tournaments_public()
returns table (
  id uuid,
  name text,
  game text,
  description text,
  tournament_at timestamptz,
  registration_deadline timestamptz,
  max_players integer,
  rules text,
  entry_details text,
  prize_details text,
  points_per_win integer,
  status text,
  featured boolean,
  players_registered bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id, t.name, t.game, t.description, t.tournament_at, t.registration_deadline,
    t.max_players, t.rules, t.entry_details, t.prize_details, t.points_per_win,
    t.status,
    t.featured,
    (count(r.id) filter (where r.status = 'registered'))::bigint,
    t.created_at
  from public.tournaments t
  left join public.tournament_registrations r on r.tournament_id = t.id
  group by t.id
  order by t.featured desc, t.tournament_at asc;
$$;

create or replace function public.get_tournament_details(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  admin_view boolean := public.is_admin();
begin
  select jsonb_build_object(
    'tournament', to_jsonb(t),
    'players_registered', (
      select count(*) from public.tournament_registrations r
      where r.tournament_id = t.id and r.status = 'registered'
    ),
    'is_registered', (
      select exists (
        select 1 from public.tournament_registrations r
        where r.tournament_id = t.id and r.user_id = auth.uid() and r.status = 'registered'
      )
    ),
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', case when admin_view then r.user_id else null end,
          'name', coalesce(nullif(p.full_name, ''), p.game_id),
          'game_id', p.game_id,
          'registered_at', r.registered_at
        ) order by r.registered_at, p.game_id
      )
      from public.tournament_registrations r
      join public.profiles p on p.id = r.user_id
      where r.tournament_id = t.id and r.status = 'registered'
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'round_number', rd.round_number,
          'round_name', rd.name,
          'match_number', m.match_number,
          'player_a_id', case when admin_view then m.player_a_id else null end,
          'player_b_id', case when admin_view then m.player_b_id else null end,
          'player_a', pa.game_id,
          'player_a_name', coalesce(nullif(pa.full_name, ''), pa.game_id),
          'player_b', pb.game_id,
          'player_b_name', coalesce(nullif(pb.full_name, ''), pb.game_id),
          'player_a_won', m.winner_id is not null and m.winner_id = m.player_a_id,
          'player_b_won', m.winner_id is not null and m.winner_id = m.player_b_id,
          'score_a', m.score_a,
          'score_b', m.score_b,
          'winner_id', case when admin_view then m.winner_id else null end,
          'winner', pw.game_id,
          'winner_name', coalesce(nullif(pw.full_name, ''), pw.game_id),
          'status', m.status
        ) order by rd.round_number, m.match_number
      )
      from public.tournament_matches m
      join public.tournament_rounds rd on rd.id = m.round_id
      left join public.profiles pa on pa.id = m.player_a_id
      left join public.profiles pb on pb.id = m.player_b_id
      left join public.profiles pw on pw.id = m.winner_id
      where m.tournament_id = t.id
    ), '[]'::jsonb)
  ) into payload
  from public.tournaments t
  where t.id = p_tournament_id;

  if payload is null then
    raise exception 'Tournament not found';
  end if;
  return payload;
end;
$$;

create or replace function public.get_tournament_leaderboard(p_game text default null)
returns table (
  rank bigint,
  game_id text,
  player_name text,
  total_points bigint,
  wins bigint,
  losses bigint,
  tournaments_played bigint,
  tournament_wins bigint,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with gamer_stats as (
    select
      p.id,
      p.game_id,
      coalesce(nullif(p.full_name, ''), p.game_id) as player_name,
      coalesce((
        select sum(pt.points)
        from public.tournament_points_transactions pt
        join public.tournament_matches scored_match on scored_match.id = pt.match_id
        join public.tournaments scored_tournament on scored_tournament.id = scored_match.tournament_id
        where pt.user_id = p.id
          and (p_game is null or lower(scored_tournament.game) = lower(p_game))
      ), 0)::bigint as total_points,
      (count(distinct m.id) filter (where m.status = 'completed' and m.winner_id = p.id))::bigint as wins,
      (count(distinct m.id) filter (where m.status = 'completed' and m.winner_id <> p.id))::bigint as losses,
      count(distinct m.tournament_id)::bigint as tournaments_played,
      (count(distinct m.tournament_id) filter (
        where m.status = 'completed'
          and m.winner_id = p.id
          and t.status = 'completed'
          and rd.round_number = (
            select max(final_round.round_number)
            from public.tournament_rounds final_round
            where final_round.tournament_id = t.id
          )
      ))::bigint as tournament_wins,
      p.id = auth.uid() as is_current_user
    from public.profiles p
    left join public.tournament_matches m on p.id in (m.player_a_id, m.player_b_id)
    left join public.tournaments t on t.id = m.tournament_id
    left join public.tournament_rounds rd on rd.id = m.round_id
    where p.role = 'gamer'
      and (p_game is null or lower(t.game) = lower(p_game))
    group by p.id
  ),
  ranked as (
    select row_number() over (
      order by gs.total_points desc, gs.wins desc, gs.tournament_wins desc, gs.game_id
    ) as placement, gs.*
    from gamer_stats gs
    where gs.tournaments_played > 0 or gs.is_current_user
  )
  select r.placement, r.game_id, r.player_name, r.total_points, r.wins, r.losses,
    r.tournaments_played, r.tournament_wins, r.is_current_user
  from ranked r
  where r.placement <= 100 or r.is_current_user
  order by r.placement
  limit 101;
$$;

create or replace function public.get_my_tournament_history()
returns table (
  tournament_id uuid,
  tournament_name text,
  game text,
  status text,
  tournament_at timestamptz,
  matches_played bigint,
  wins bigint,
  losses bigint,
  points bigint,
  tournament_win boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Sign in as a gamer to view your tournament history';
  end if;

  return query
  with my_tournaments as (
    select distinct t.id, t.name, t.game, t.status, t.tournament_at
    from public.tournaments t
    join public.tournament_registrations r on r.tournament_id = t.id
    where r.user_id = auth.uid()
  ),
  match_stats as (
    select
      m.tournament_id,
      (count(*) filter (where m.status = 'completed' and m.winner_id in (m.player_a_id, m.player_b_id)))::bigint as matches_played,
      (count(*) filter (where m.status = 'completed' and m.winner_id = auth.uid()))::bigint as wins,
      (count(*) filter (where m.status = 'completed' and m.winner_id <> auth.uid()))::bigint as losses
    from public.tournament_matches m
    where auth.uid() in (m.player_a_id, m.player_b_id)
    group by m.tournament_id
  ),
  point_stats as (
    select m.tournament_id, sum(pt.points)::bigint as points
    from public.tournament_points_transactions pt
    join public.tournament_matches m on m.id = pt.match_id
    where pt.user_id = auth.uid()
    group by m.tournament_id
  )
  select
    t.id, t.name, t.game, t.status, t.tournament_at,
    coalesce(ms.matches_played, 0), coalesce(ms.wins, 0), coalesce(ms.losses, 0),
    coalesce(ps.points, 0),
    exists (
      select 1
      from public.tournament_matches final_match
      join public.tournaments completed_tournament on completed_tournament.id = final_match.tournament_id
      join public.tournament_rounds final_round on final_round.id = final_match.round_id
      where final_match.tournament_id = t.id
        and completed_tournament.status = 'completed'
        and final_match.status = 'completed'
        and final_match.winner_id = auth.uid()
        and final_round.round_number = (
          select max(last_round.round_number)
          from public.tournament_rounds last_round
          where last_round.tournament_id = t.id
        )
    )
  from my_tournaments t
  left join match_stats ms on ms.tournament_id = t.id
  left join point_stats ps on ps.tournament_id = t.id
  order by t.tournament_at desc;
end;
$$;

create or replace function public.get_tournament_standings(p_tournament_id uuid)
returns table (
  rank bigint,
  game_id text,
  player_name text,
  wins bigint,
  losses bigint,
  points bigint,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with participants as (
    select distinct p.id, p.game_id, coalesce(nullif(p.full_name, ''), p.game_id) as player_name,
      p.id = auth.uid() as is_current_user
    from public.tournament_registrations r
    join public.profiles p on p.id = r.user_id
    where r.tournament_id = p_tournament_id and r.status = 'registered'
  ),
  stats as (
    select
      p.id,
      p.game_id,
      p.player_name,
      coalesce(count(m.id) filter (where m.status = 'completed' and m.winner_id = p.id), 0)::bigint as wins,
      coalesce(count(m.id) filter (where m.status = 'completed' and m.winner_id <> p.id), 0)::bigint as losses,
      coalesce((
        select sum(pt.points)
        from public.tournament_points_transactions pt
        join public.tournament_matches scored_match on scored_match.id = pt.match_id
        where pt.user_id = p.id and scored_match.tournament_id = p_tournament_id
      ), 0)::bigint as points,
      p.is_current_user
    from participants p
    left join public.tournament_matches m
      on m.tournament_id = p_tournament_id and p.id in (m.player_a_id, m.player_b_id)
    group by p.id, p.game_id, p.player_name, p.is_current_user
  ),
  ranked as (
    select row_number() over (order by s.points desc, s.wins desc, s.game_id) as placement, s.*
    from stats s
  )
  select r.placement, r.game_id, r.player_name, r.wins, r.losses, r.points, r.is_current_user
  from ranked r
  order by r.placement;
$$;

create or replace function public.admin_get_tournament_audit(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  audit_data jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.tournaments where id = p_tournament_id) then
    raise exception 'Tournament not found';
  end if;

  select jsonb_build_object(
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'version', result.result_version,
        'match_number', m.match_number,
        'round_name', rd.name,
        'score', concat(result.score_a, ' - ', result.score_b),
        'winner', coalesce(nullif(winner.full_name, ''), winner.game_id),
        'changed_by', coalesce(nullif(admin_profile.full_name, ''), admin_profile.game_id),
        'created_at', result.created_at
      ) order by result.created_at desc)
      from public.tournament_match_results result
      join public.tournament_matches m on m.id = result.match_id
      join public.tournament_rounds rd on rd.id = m.round_id
      join public.profiles winner on winner.id = result.winner_id
      join public.profiles admin_profile on admin_profile.id = result.changed_by
      where m.tournament_id = p_tournament_id
    ), '[]'::jsonb),
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_number', m.match_number,
        'round_name', rd.name,
        'player', coalesce(nullif(player.full_name, ''), player.game_id),
        'type', pt.transaction_type,
        'points', pt.points,
        'created_at', pt.created_at
      ) order by pt.created_at desc)
      from public.tournament_points_transactions pt
      join public.tournament_matches m on m.id = pt.match_id
      join public.tournament_rounds rd on rd.id = m.round_id
      join public.profiles player on player.id = pt.user_id
      where m.tournament_id = p_tournament_id
    ), '[]'::jsonb)
  ) into audit_data;
  return audit_data;
end;
$$;

create or replace function public.register_for_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_tournament public.tournaments;
begin
  if auth.uid() is null or public.is_admin() then
    raise exception 'Sign in as a gamer to register';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'gamer') then
    raise exception 'Gamer account required';
  end if;

  select * into selected_tournament
  from public.tournaments
  where id = p_tournament_id
  for update;
  if not found then raise exception 'Tournament not found'; end if;
  if selected_tournament.status <> 'registration_open'
     or selected_tournament.registration_deadline <= now() then
    raise exception 'Registration is closed';
  end if;

  if not exists (
    select 1 from public.tournament_registrations
    where tournament_id = p_tournament_id and user_id = auth.uid() and status = 'registered'
  ) and (
    select count(*) from public.tournament_registrations
    where tournament_id = p_tournament_id and status = 'registered'
  ) >= selected_tournament.max_players then
    raise exception 'This tournament is full';
  end if;

  insert into public.tournament_registrations (tournament_id, user_id, status, registered_at, updated_at)
  values (p_tournament_id, auth.uid(), 'registered', now(), now())
  on conflict (tournament_id, user_id) do update
    set status = 'registered', registered_at = now(), updated_at = now();
end;
$$;

create or replace function public.withdraw_from_tournament(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_tournament public.tournaments;
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw'; end if;
  select * into selected_tournament from public.tournaments
    where id = p_tournament_id for update;
  if not found or selected_tournament.status <> 'registration_open'
     or selected_tournament.registration_deadline <= now() then
    raise exception 'Registration is closed';
  end if;
  if exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id
      and auth.uid() in (player_a_id, player_b_id)
  ) then raise exception 'You cannot withdraw after bracket matchups are assigned'; end if;
  update public.tournament_registrations
    set status = 'withdrawn', updated_at = now()
    where tournament_id = p_tournament_id and user_id = auth.uid() and status = 'registered';
  if not found then raise exception 'You are not registered for this tournament'; end if;
end;
$$;

create or replace function public.admin_save_tournament(
  p_tournament_id uuid,
  p_name text,
  p_game text,
  p_description text,
  p_tournament_at timestamptz,
  p_registration_deadline timestamptz,
  p_max_players integer,
  p_rules text,
  p_entry_details text,
  p_prize_details text,
  p_points_per_win integer,
  p_featured boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_tournament_id is not null then
    perform 1 from public.tournaments where id = p_tournament_id for update;
    if not found then raise exception 'Tournament not found'; end if;
  end if;
  if length(trim(p_name)) not between 2 and 120 or length(trim(p_game)) not between 1 and 80 then
    raise exception 'Enter a tournament name and game';
  end if;
  if p_tournament_at is null or p_registration_deadline is null
     or p_registration_deadline > p_tournament_at then
    raise exception 'Registration deadline must be before the tournament date';
  end if;
  if p_max_players not between 2 and 512 or p_points_per_win < 0 then
    raise exception 'Player limit must be 2–512 and points cannot be negative';
  end if;

  if p_tournament_id is null then
    insert into public.tournaments (
      name, game, description, tournament_at, registration_deadline,
      max_players, rules, entry_details, prize_details, points_per_win, featured
    ) values (
      trim(p_name), trim(p_game), coalesce(p_description, ''),
      p_tournament_at, p_registration_deadline, p_max_players, coalesce(p_rules, ''),
      coalesce(nullif(trim(p_entry_details), ''), 'Free entry'),
      coalesce(nullif(trim(p_prize_details), ''), 'Tournament points'),
      p_points_per_win, coalesce(p_featured, false)
    ) returning id into saved_id;
  else
    if p_max_players < (
      select count(*) from public.tournament_registrations
      where tournament_id = p_tournament_id and status = 'registered'
    ) then raise exception 'Maximum players cannot be lower than current registrations'; end if;
    if exists (
      select 1 from public.tournaments
      where id = p_tournament_id and status = 'registration_open'
        and p_registration_deadline <= now()
    ) then raise exception 'Close registration before setting a past deadline'; end if;
    update public.tournaments set
      name = trim(p_name), game = trim(p_game), description = coalesce(p_description, ''),
      tournament_at = p_tournament_at, registration_deadline = p_registration_deadline,
      max_players = p_max_players, rules = coalesce(p_rules, ''),
      entry_details = coalesce(nullif(trim(p_entry_details), ''), 'Free entry'),
      prize_details = coalesce(nullif(trim(p_prize_details), ''), 'Tournament points'),
      points_per_win = p_points_per_win, featured = coalesce(p_featured, false),
      updated_at = now()
    where id = p_tournament_id and status in ('created', 'registration_open', 'registration_closed');
    if not found then raise exception 'Tournament not found or bracket already prepared'; end if;
    saved_id := p_tournament_id;
  end if;
  return saved_id;
end;
$$;

create or replace function public.admin_set_tournament_status(p_tournament_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  current_deadline timestamptz;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select status, registration_deadline into current_status, current_deadline
    from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;

  if p_status = 'cancelled' and current_status not in ('completed', 'cancelled') then
    update public.tournaments set status = 'cancelled', featured = false, updated_at = now()
      where id = p_tournament_id;
  elsif p_status = 'registration_open' and current_status in ('created', 'registration_closed') then
    if current_deadline <= now() then raise exception 'Registration deadline has passed'; end if;
    update public.tournaments set status = p_status, updated_at = now() where id = p_tournament_id;
  elsif p_status = 'registration_closed' and current_status = 'registration_open' then
    update public.tournaments set status = p_status, updated_at = now() where id = p_tournament_id;
  elsif p_status = 'live' and current_status = 'bracket_ready' then
    if exists (
      select 1
      from public.tournament_matches m
      join public.tournament_rounds r on r.id = m.round_id
      where m.tournament_id = p_tournament_id and r.round_number = 1
        and m.status <> 'bye'
        and (m.player_a_id is null or m.player_b_id is null)
    ) then raise exception 'Assign every first-round matchup before starting'; end if;
    if (
      select count(distinct assigned.player_id)
      from (
        select m.player_a_id as player_id
        from public.tournament_matches m
        join public.tournament_rounds r on r.id = m.round_id
        where m.tournament_id = p_tournament_id and r.round_number = 1
        union all
        select m.player_b_id
        from public.tournament_matches m
        join public.tournament_rounds r on r.id = m.round_id
        where m.tournament_id = p_tournament_id and r.round_number = 1
      ) assigned
      where assigned.player_id is not null
    ) <> (
      select count(*) from public.tournament_registrations
      where tournament_id = p_tournament_id and status = 'registered'
    ) then raise exception 'Assign every registered player exactly once before starting'; end if;
    update public.tournaments set status = p_status, started_at = now(), updated_at = now()
      where id = p_tournament_id;
  elsif p_status = 'completed' and current_status = 'live' then
    if exists (
      select 1 from public.tournament_matches
      where tournament_id = p_tournament_id and status not in ('completed', 'bye')
    ) then raise exception 'Confirm every match before finishing the tournament'; end if;
    if not exists (
      select 1 from public.tournament_matches m
      join public.tournament_rounds r on r.id = m.round_id
      where m.tournament_id = p_tournament_id and m.status = 'completed'
        and r.round_number = (
          select max(last_round.round_number) from public.tournament_rounds last_round
          where last_round.tournament_id = p_tournament_id
        )
    ) then raise exception 'A final match result is required'; end if;
    update public.tournaments set status = p_status, completed_at = now(), updated_at = now()
      where id = p_tournament_id;
  else
    raise exception 'Invalid tournament status transition';
  end if;
end;
$$;

create or replace function public.admin_build_tournament_bracket(
  p_tournament_id uuid,
  p_randomize boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_tournament public.tournaments;
  player_ids uuid[];
  player_count integer;
  bracket_size integer := 2;
  round_count integer := 1;
  round_size integer;
  current_round_id uuid;
  next_round_id uuid;
  match_index integer;
  round_index integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  perform 1 from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  select * into selected_tournament from public.tournaments
    where id = p_tournament_id for update;
  if not found or selected_tournament.status <> 'registration_closed' then
    raise exception 'Close registration before preparing the bracket';
  end if;

  select array_agg(user_id order by case when p_randomize then random() end, registered_at, user_id) into player_ids
  from public.tournament_registrations
  where tournament_id = p_tournament_id and status = 'registered';
  player_count := coalesce(cardinality(player_ids), 0);
  if player_count < 2 then raise exception 'At least two registered players are required'; end if;
  if player_count > selected_tournament.max_players then raise exception 'Player limit exceeded'; end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id) then
    raise exception 'A bracket already exists';
  end if;

  while bracket_size < player_count loop
    bracket_size := bracket_size * 2;
    round_count := round_count + 1;
  end loop;

  for round_index in 1..round_count loop
    round_size := bracket_size / (2 ^ round_index);
    insert into public.tournament_rounds (tournament_id, round_number, name)
    values (
      p_tournament_id,
      round_index,
      case
        when round_size = 1 then 'Final'
        when round_size = 2 then 'Semifinals'
        when round_size = 4 then 'Quarterfinals'
        else 'Round of ' || (round_size * 2)
      end
    );
    select id into current_round_id from public.tournament_rounds
    where tournament_id = p_tournament_id and round_number = round_index;
    for match_index in 1..round_size loop
      insert into public.tournament_matches (tournament_id, round_id, match_number)
    values (p_tournament_id, current_round_id, match_index);
    end loop;
  end loop;

  for match_index in 1..(bracket_size / 2) loop
    select id into current_round_id from public.tournament_rounds
      where tournament_id = p_tournament_id and round_number = 1;
    if p_randomize then
      update public.tournament_matches set
        player_a_id = case
          when match_index <= (bracket_size - player_count) then player_ids[match_index]
          else player_ids[2 * match_index - (bracket_size - player_count) - 1]
        end,
        player_b_id = case
          when match_index <= (bracket_size - player_count) then null
          else player_ids[2 * match_index - (bracket_size - player_count)]
        end,
        status = case when match_index <= (bracket_size - player_count) then 'bye' else 'scheduled' end,
        winner_id = case when match_index <= (bracket_size - player_count) then player_ids[match_index] end,
        updated_at = now()
      where tournament_id = p_tournament_id and tournament_matches.round_id = current_round_id
        and tournament_matches.match_number = match_index;
    else
      update public.tournament_matches set
        player_a_id = case when match_index <= (bracket_size - player_count) then player_ids[match_index] end,
        player_b_id = null,
        status = case when match_index <= (bracket_size - player_count) then 'bye' else 'scheduled' end,
        winner_id = case when match_index <= (bracket_size - player_count) then player_ids[match_index] end,
        updated_at = now()
      where tournament_id = p_tournament_id and tournament_matches.round_id = current_round_id
        and tournament_matches.match_number = match_index;
    end if;

    if round_count > 1 and match_index <= (bracket_size - player_count) then
      select id into next_round_id from public.tournament_rounds
        where tournament_id = p_tournament_id and round_number = 2;
      update public.tournament_matches set
        player_a_id = case when match_index % 2 = 1 then player_ids[match_index] else player_a_id end,
        player_b_id = case when match_index % 2 = 0 then player_ids[match_index] else player_b_id end,
        updated_at = now()
      where tournament_id = p_tournament_id and tournament_matches.round_id = next_round_id
        and tournament_matches.match_number = (match_index + 1) / 2;
    end if;
  end loop;

  update public.tournaments set status = 'bracket_ready', updated_at = now()
    where id = p_tournament_id;
  return bracket_size;
end;
$$;

create or replace function public.admin_save_matchup(
  p_match_id uuid,
  p_tournament_id uuid,
  p_round_number integer,
  p_match_number integer,
  p_player_a_id uuid,
  p_player_b_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match public.tournament_matches;
  target_round uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  perform 1 from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if p_player_a_id is not null and p_player_a_id = p_player_b_id then
    raise exception 'A player cannot be matched against themselves';
  end if;
  if p_player_a_id is not null and not exists (
    select 1 from public.tournament_registrations
    where tournament_id = p_tournament_id and user_id = p_player_a_id and status = 'registered'
  ) then raise exception 'Player A is not registered'; end if;
  if p_player_b_id is not null and not exists (
    select 1 from public.tournament_registrations
    where tournament_id = p_tournament_id and user_id = p_player_b_id and status = 'registered'
  ) then raise exception 'Player B is not registered'; end if;
  if p_player_a_id is not null and exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id and id is distinct from p_match_id
      and round_id = (select id from public.tournament_rounds where tournament_id = p_tournament_id and round_number = 1)
      and p_player_a_id in (player_a_id, player_b_id)
  ) then raise exception 'Player A is already assigned to a first-round match'; end if;
  if p_player_b_id is not null and exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id and id is distinct from p_match_id
      and round_id = (select id from public.tournament_rounds where tournament_id = p_tournament_id and round_number = 1)
      and p_player_b_id in (player_a_id, player_b_id)
  ) then raise exception 'Player B is already assigned to a first-round match'; end if;
  if p_round_number <> 1 or p_match_number < 1 then
    raise exception 'Only first-round matchups can be assigned manually';
  end if;
  if not exists (
    select 1 from public.tournaments
    where id = p_tournament_id and status in ('bracket_ready', 'live')
  ) then raise exception 'Prepare the bracket before assigning matchups'; end if;

  select id into target_round from public.tournament_rounds
    where tournament_id = p_tournament_id and round_number = 1;
  if target_round is null then raise exception 'Tournament bracket not found'; end if;

  if p_match_id is null then
    insert into public.tournament_matches (
      tournament_id, round_id, match_number, player_a_id, player_b_id
    ) values (
      p_tournament_id, target_round, p_match_number, p_player_a_id, p_player_b_id
    ) returning * into target_match;
  else
    select * into target_match from public.tournament_matches
      where id = p_match_id and tournament_id = p_tournament_id and round_id = target_round
      for update;
    if not found or target_match.status = 'completed' then
      raise exception 'Match not found or its result is confirmed';
    end if;
    if target_match.status = 'bye' and target_match.winner_id is not null then
      declare
        next_round_id uuid;
        next_match public.tournament_matches;
      begin
        select id into next_round_id from public.tournament_rounds
          where tournament_id = p_tournament_id and round_number = 2;
        if next_round_id is not null then
          select * into next_match from public.tournament_matches
            where round_id = next_round_id and match_number = (target_match.match_number + 1) / 2
            for update;
          if found and next_match.winner_id is not null then
            raise exception 'Cannot edit this bye after the next-round result is confirmed';
          end if;
          if found and target_match.match_number % 2 = 1 and next_match.player_a_id = target_match.winner_id then
            update public.tournament_matches set
              player_a_id = null, score_a = null, score_b = null, winner_id = null,
              status = 'scheduled', result_confirmed_at = null, updated_at = now()
              where id = next_match.id;
          elsif found and target_match.match_number % 2 = 0 and next_match.player_b_id = target_match.winner_id then
            update public.tournament_matches set
              player_b_id = null, score_a = null, score_b = null, winner_id = null,
              status = 'scheduled', result_confirmed_at = null, updated_at = now()
              where id = next_match.id;
          end if;
        end if;
      end;
    end if;
    update public.tournament_matches set
      player_a_id = p_player_a_id,
      player_b_id = p_player_b_id,
      score_a = null,
      score_b = null,
      winner_id = null,
      status = 'scheduled',
      result_confirmed_at = null,
      updated_at = now()
    where id = p_match_id and tournament_id = p_tournament_id and round_id = target_round
      and status <> 'completed'
    returning * into target_match;
    if not found then raise exception 'Match not found or its result is confirmed'; end if;
  end if;
  return target_match.id;
end;
$$;

create or replace function public.admin_record_match_result(
  p_match_id uuid,
  p_score_a integer,
  p_score_b integer,
  p_winner_id uuid,
  p_confirm boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_id_for_match uuid;
  selected_match public.tournament_matches;
  selected_tournament public.tournaments;
  old_winner uuid;
  target_round public.tournament_rounds;
  target_match_number integer;
  target_match public.tournament_matches;
  result_version integer;
  next_slot_player uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select tournament_id into tournament_id_for_match from public.tournament_matches
    where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  select * into selected_tournament from public.tournaments
    where id = tournament_id_for_match for update;
  if not found then raise exception 'Tournament not found'; end if;
  select * into selected_match from public.tournament_matches
    where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if selected_tournament.status <> 'live' then raise exception 'Tournament is not live'; end if;
  if selected_match.player_a_id is null or selected_match.player_b_id is null then
    raise exception 'Both registered players must be assigned before scoring';
  end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 then
    raise exception 'Enter valid non-negative scores';
  end if;
  if p_confirm and (p_score_a = p_score_b or p_winner_id is null) then
    raise exception 'A confirmed match needs a non-tied score and a winner';
  end if;
  if p_confirm and not (
    (p_winner_id = selected_match.player_a_id and p_score_a > p_score_b)
    or (p_winner_id = selected_match.player_b_id and p_score_b > p_score_a)
  ) then raise exception 'The winner must have the higher score'; end if;
  if not p_confirm and selected_match.status = 'completed' then
    raise exception 'A confirmed result can only be corrected with another confirmed result';
  end if;

  old_winner := selected_match.winner_id;
  if p_confirm and old_winner is distinct from p_winner_id then
    select * into target_round from public.tournament_rounds
      where tournament_id = selected_match.tournament_id
        and round_number = (
          select current_round.round_number + 1
          from public.tournament_rounds current_round
          where current_round.id = selected_match.round_id
        );
    if target_round.id is not null then
      target_match_number := (selected_match.match_number + 1) / 2;
      select * into target_match from public.tournament_matches
        where round_id = target_round.id and match_number = target_match_number
        for update;
      if found and target_match.winner_id is not null then
        raise exception 'Cannot change this winner after the next-round result is confirmed';
      end if;
      if found then
        next_slot_player := case when selected_match.match_number % 2 = 1
          then target_match.player_a_id else target_match.player_b_id end;
        if next_slot_player is not null and next_slot_player is distinct from old_winner then
          raise exception 'Next-round matchup was manually changed; correct it before this result';
        end if;
      end if;
    end if;
  end if;

  if p_confirm then
    select coalesce(max(result.result_version), 0) + 1 into result_version
      from public.tournament_match_results result where result.match_id = selected_match.id;
    if selected_match.status = 'completed'
      and selected_match.score_a = p_score_a
      and selected_match.score_b = p_score_b
      and selected_match.winner_id = p_winner_id then
      return;
    end if;

    insert into public.tournament_match_results (
      match_id, result_version, changed_by, score_a, score_b, winner_id
    ) values (
      selected_match.id, result_version, auth.uid(), p_score_a, p_score_b, p_winner_id
    );

    if selected_tournament.points_per_win > 0
      and old_winner is not null and old_winner is distinct from p_winner_id then
      insert into public.tournament_points_transactions (
        match_id, result_version, user_id, transaction_type, points, created_by
      ) values (
        selected_match.id, result_version, old_winner, 'reversal',
        -selected_tournament.points_per_win, auth.uid()
      );
    end if;
    if selected_tournament.points_per_win > 0 and old_winner is distinct from p_winner_id then
      insert into public.tournament_points_transactions (
        match_id, result_version, user_id, transaction_type, points, created_by
      ) values (
        selected_match.id, result_version, p_winner_id, 'award',
        selected_tournament.points_per_win, auth.uid()
      );
    end if;

    update public.tournament_matches set
      score_a = p_score_a, score_b = p_score_b, winner_id = p_winner_id,
      status = 'completed', result_confirmed_at = now(), updated_at = now()
    where id = selected_match.id;

    if target_round.id is not null then
      if selected_match.match_number % 2 = 1 then
        update public.tournament_matches set
          player_a_id = p_winner_id,
          score_a = null, score_b = null, winner_id = null, status = 'scheduled',
          result_confirmed_at = null, updated_at = now()
        where round_id = target_round.id and match_number = target_match_number
          and (player_a_id is null or player_a_id = old_winner);
      else
        update public.tournament_matches set
          player_b_id = p_winner_id,
          score_a = null, score_b = null, winner_id = null, status = 'scheduled',
          result_confirmed_at = null, updated_at = now()
        where round_id = target_round.id and match_number = target_match_number
          and (player_b_id is null or player_b_id = old_winner);
      end if;
    end if;
  else
    update public.tournament_matches set
      score_a = p_score_a, score_b = p_score_b, status = 'live', updated_at = now()
    where id = selected_match.id;
  end if;
end;
$$;

revoke all on function public.get_tournaments_public() from public;
revoke all on function public.get_tournament_details(uuid) from public;
revoke all on function public.get_tournament_leaderboard(text) from public;
revoke all on function public.get_my_tournament_history() from public;
revoke all on function public.get_tournament_standings(uuid) from public;
revoke all on function public.admin_get_tournament_audit(uuid) from public;
revoke all on function public.register_for_tournament(uuid) from public;
revoke all on function public.withdraw_from_tournament(uuid) from public;
revoke all on function public.admin_save_tournament(uuid, text, text, text, timestamptz, timestamptz, integer, text, text, text, integer, boolean) from public;
revoke all on function public.admin_set_tournament_status(uuid, text) from public;
revoke all on function public.admin_build_tournament_bracket(uuid, boolean) from public;
revoke all on function public.admin_save_matchup(uuid, uuid, integer, integer, uuid, uuid) from public;
revoke all on function public.admin_record_match_result(uuid, integer, integer, uuid, boolean) from public;

grant execute on function public.get_tournaments_public() to anon, authenticated;
grant execute on function public.get_tournament_details(uuid) to anon, authenticated;
grant execute on function public.get_tournament_leaderboard(text) to anon, authenticated;
grant execute on function public.get_my_tournament_history() to authenticated;
grant execute on function public.get_tournament_standings(uuid) to anon, authenticated;
grant execute on function public.admin_get_tournament_audit(uuid) to authenticated;
grant execute on function public.register_for_tournament(uuid) to authenticated;
grant execute on function public.withdraw_from_tournament(uuid) to authenticated;
grant execute on function public.admin_save_tournament(uuid, text, text, text, timestamptz, timestamptz, integer, text, text, text, integer, boolean) to authenticated;
grant execute on function public.admin_set_tournament_status(uuid, text) to authenticated;
grant execute on function public.admin_build_tournament_bracket(uuid, boolean) to authenticated;
grant execute on function public.admin_save_matchup(uuid, uuid, integer, integer, uuid, uuid) to authenticated;
grant execute on function public.admin_record_match_result(uuid, integer, integer, uuid, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.tournaments;
  alter publication supabase_realtime add table public.tournament_registrations;
  alter publication supabase_realtime add table public.tournament_rounds;
  alter publication supabase_realtime add table public.tournament_matches;
exception when duplicate_object or undefined_object then
  null;
end;
$$;
