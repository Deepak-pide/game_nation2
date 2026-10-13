create table if not exists public.analytics_settings (
  singleton boolean primary key default true check (singleton),
  reset_at timestamptz not null default '1970-01-01 00:00:00+00'
);
insert into public.analytics_settings (singleton) values (true)
on conflict (singleton) do nothing;
alter table public.analytics_settings enable row level security;
drop policy if exists analytics_settings_admin_read on public.analytics_settings;
create policy analytics_settings_admin_read on public.analytics_settings
  for select to authenticated using (public.is_admin());
grant select on public.analytics_settings to authenticated;

create table if not exists public.quick_timer_settings (
  singleton boolean primary key default true check (singleton),
  quick_booking_minutes integer not null default 40 check (quick_booking_minutes between 1 and 1440),
  quick_start_minutes integer not null default 40 check (quick_start_minutes between 1 and 1440)
);
insert into public.quick_timer_settings (singleton) values (true)
on conflict (singleton) do nothing;
alter table public.quick_timer_settings enable row level security;
drop policy if exists quick_timer_settings_admin_read on public.quick_timer_settings;
create policy quick_timer_settings_admin_read on public.quick_timer_settings
  for select to authenticated using (public.is_admin());
grant select on public.quick_timer_settings to authenticated;

alter table public.quick_booking_sessions
  add column if not exists duration_minutes integer not null default 40
    check (duration_minutes between 1 and 1440);

create table if not exists public.admin_quick_start_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  players smallint not null check (players in (1, 2, 3)),
  total_price numeric(10, 2) not null check (total_price > 0),
  duration_minutes integer not null default 40 check (duration_minutes between 1 and 1440),
  status text not null default 'running' check (status in ('running', 'paused', 'stopped')),
  accumulated_seconds bigint not null default 0 check (accumulated_seconds >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_quick_start_running_started check ((status = 'running') = (started_at is not null)),
  constraint admin_quick_start_terminal_ended check ((status = 'stopped') = (ended_at is not null))
);

alter table public.admin_quick_start_sessions enable row level security;
drop policy if exists admin_quick_start_sessions_admin_read on public.admin_quick_start_sessions;
create policy admin_quick_start_sessions_admin_read on public.admin_quick_start_sessions
  for select to authenticated using (public.is_admin());
grant select on public.admin_quick_start_sessions to authenticated;

create or replace function public.admin_set_quick_timer_settings(
  p_quick_booking_minutes integer,
  p_quick_start_minutes integer
)
returns public.quick_timer_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_settings public.quick_timer_settings;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_quick_booking_minutes is null or p_quick_booking_minutes not between 1 and 1440
     or p_quick_start_minutes is null or p_quick_start_minutes not between 1 and 1440 then
    raise exception 'Timer lengths must be between 1 and 1440 minutes';
  end if;

  update public.quick_timer_settings
     set quick_booking_minutes = p_quick_booking_minutes,
         quick_start_minutes = p_quick_start_minutes
   where singleton
   returning * into saved_settings;
  return saved_settings;
end;
$$;

revoke all on function public.admin_set_quick_timer_settings(integer, integer) from public, anon;
grant execute on function public.admin_set_quick_timer_settings(integer, integer) to authenticated;

create table if not exists public.admin_wallet_transactions (
  id bigint generated always as identity primary key,
  quick_booking_id uuid unique,
  quick_start_session_id uuid unique references public.admin_quick_start_sessions(id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint admin_wallet_transactions_source check (
    (quick_booking_id is not null) <> (quick_start_session_id is not null)
  )
);

alter table public.admin_wallet_transactions enable row level security;
drop policy if exists admin_wallet_transactions_admin_read on public.admin_wallet_transactions;
create policy admin_wallet_transactions_admin_read on public.admin_wallet_transactions
  for select to authenticated using (public.is_admin());
grant select on public.admin_wallet_transactions to authenticated;

create or replace function public.record_quick_booking_revenue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_wallet_transactions (quick_booking_id, amount)
  values (new.id, new.total_price);
  return new;
end;
$$;

drop trigger if exists quick_booking_adds_admin_wallet_credit on public.quick_bookings;
create trigger quick_booking_adds_admin_wallet_credit
  after insert on public.quick_bookings
  for each row execute function public.record_quick_booking_revenue();
revoke all on function public.record_quick_booking_revenue() from public;
insert into public.admin_wallet_transactions (quick_booking_id, amount, created_at)
select quick.id, quick.total_price, quick.created_at
  from public.quick_bookings quick
on conflict (quick_booking_id) do nothing;

create or replace function public.guest_list_quick_booking_slots(
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (id uuid, console_name text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select slot.id, console.name, slot.starts_at, slot.ends_at
    from public.availability_slots slot
    join public.consoles console on console.id = slot.console_id and console.active
   where slot.available
     and slot.starts_at > now()
     and slot.starts_at < p_ends_at
     and slot.ends_at > p_starts_at
     and not exists (
       select 1 from public.bookings booking
        where booking.console_id = slot.console_id
          and booking.status in ('pending', 'approved', 'completed')
          and booking.starts_at < slot.ends_at
          and booking.ends_at > slot.starts_at
     )
     and not exists (
       select 1 from public.quick_bookings quick
       join public.availability_slots booked_slot on booked_slot.id = quick.slot_id
        where booked_slot.console_id = slot.console_id
          and booked_slot.starts_at < slot.ends_at
          and booked_slot.ends_at > slot.starts_at
     )
   order by slot.starts_at, console.name;
$$;

drop function if exists public.guest_create_quick_booking(uuid, text);
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
begin
  if auth.uid() is not null and public.is_admin() then
    raise exception 'Use the admin Quick Start for administrator bookings';
  end if;
  if p_players is null or p_players not in (1, 2, 3) then
    raise exception 'Choose 1, 2, or 3 players';
  end if;
  return public.create_quick_booking(p_slot_id, p_name, p_players);
end;
$$;

create or replace function public.admin_reset_analytics()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  reset_time timestamptz := now();
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  update public.analytics_settings set reset_at = reset_time where singleton;
  return reset_time;
end;
$$;

revoke all on function public.guest_list_quick_booking_slots(timestamptz, timestamptz) from public;
revoke all on function public.guest_create_quick_booking(uuid, text, integer) from public;
revoke all on function public.admin_reset_analytics() from public, anon;
grant execute on function public.guest_list_quick_booking_slots(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.guest_create_quick_booking(uuid, text, integer) to anon, authenticated;
grant execute on function public.admin_reset_analytics() to authenticated;

create or replace function public.admin_update_quick_booking_session(p_quick_booking_id uuid, p_action text)
returns public.quick_booking_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.quick_booking_sessions;
  updated_session public.quick_booking_sessions;
  timer_minutes integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_action is null or p_action not in ('start', 'pause', 'resume', 'stop') then
    raise exception 'Invalid Quick Book timer action';
  end if;
  if not exists (select 1 from public.quick_bookings where id = p_quick_booking_id) then
    raise exception 'Quick booking not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_quick_booking_id::text, 1));
  select * into current_session
    from public.quick_booking_sessions
   where quick_booking_id = p_quick_booking_id
   for update;

  if not found then
    if p_action <> 'start' then
      raise exception 'Start this Quick Book timer first';
    end if;
    select quick_booking_minutes into timer_minutes
      from public.quick_timer_settings where singleton;
    insert into public.quick_booking_sessions (quick_booking_id, duration_minutes, status, started_at)
    values (p_quick_booking_id, timer_minutes, 'running', now())
    returning * into updated_session;
    return updated_session;
  end if;

  if current_session.status = 'stopped' then
    raise exception 'This Quick Book timer has already stopped';
  elsif p_action = 'start' then
    raise exception 'This Quick Book timer has already started';
  elsif p_action = 'pause' and current_session.status = 'running' then
    update public.quick_booking_sessions
       set status = 'paused',
           accumulated_seconds = accumulated_seconds
             + greatest(0, floor(extract(epoch from (now() - started_at)))::bigint),
           started_at = null,
           updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  elsif p_action = 'resume' and current_session.status = 'paused' then
    update public.quick_booking_sessions
       set status = 'running', started_at = now(), updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  elsif p_action = 'stop' then
    update public.quick_booking_sessions
       set status = 'stopped',
           accumulated_seconds = accumulated_seconds
             + case when status = 'running'
                 then greatest(0, floor(extract(epoch from (now() - started_at)))::bigint)
                 else 0
               end,
           started_at = null,
           ended_at = now(),
           updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  else
    raise exception 'Invalid Quick Book timer transition';
  end if;
  return updated_session;
end;
$$;

create or replace function public.admin_create_quick_start_session(p_name text, p_players integer)
returns public.admin_quick_start_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  created_session public.admin_quick_start_sessions;
  timer_minutes integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Enter a name up to 80 characters';
  end if;
  if p_players is null or p_players not in (1, 2, 3) then
    raise exception 'Choose 1, 2, or 3 players';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_quick_start_session', 0));
  if exists (
    select 1 from public.admin_quick_start_sessions
     where status in ('running', 'paused')
  ) then
    raise exception 'End the current Quick Start session before starting another';
  end if;

  select quick_start_minutes into timer_minutes
    from public.quick_timer_settings where singleton;
  insert into public.admin_quick_start_sessions
    (name, players, total_price, duration_minutes, status, started_at)
  values (btrim(p_name), p_players, p_players * 20, timer_minutes, 'running', now())
  returning * into created_session;

  insert into public.admin_wallet_transactions (quick_start_session_id, amount, created_at)
  values (created_session.id, created_session.total_price, created_session.created_at);
  return created_session;
end;
$$;

create or replace function public.admin_update_quick_start_session(p_session_id uuid, p_action text)
returns public.admin_quick_start_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.admin_quick_start_sessions;
  updated_session public.admin_quick_start_sessions;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_action is null or p_action not in ('pause', 'resume', 'stop') then
    raise exception 'Invalid Quick Start timer action';
  end if;

  select * into current_session
    from public.admin_quick_start_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception 'Quick Start session not found';
  end if;
  if current_session.status = 'stopped' then
    raise exception 'This Quick Start session has already ended';
  end if;

  if p_action = 'pause' and current_session.status = 'running' then
    update public.admin_quick_start_sessions
       set status = 'paused',
           accumulated_seconds = accumulated_seconds
             + greatest(0, floor(extract(epoch from (now() - started_at)))::bigint),
           started_at = null,
           updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  elsif p_action = 'resume' and current_session.status = 'paused' then
    update public.admin_quick_start_sessions
       set status = 'running',
           started_at = now(),
           updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  elsif p_action = 'stop' then
    update public.admin_quick_start_sessions
       set status = 'stopped',
           accumulated_seconds = accumulated_seconds
             + case when status = 'running'
                 then greatest(0, floor(extract(epoch from (now() - started_at)))::bigint)
                 else 0
               end,
           started_at = null,
           ended_at = now(),
           updated_at = now()
     where id = current_session.id
     returning * into updated_session;
  else
    raise exception 'Invalid Quick Start timer transition';
  end if;
  return updated_session;
end;
$$;

revoke all on function public.admin_create_quick_start_session(text, integer) from public, anon;
revoke all on function public.admin_update_quick_start_session(uuid, text) from public, anon;
grant execute on function public.admin_create_quick_start_session(text, integer) to authenticated;
grant execute on function public.admin_update_quick_start_session(uuid, text) to authenticated;
