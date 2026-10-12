create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  console_id uuid not null references public.consoles(id) on delete restrict,
  status text not null default 'running' check (status in ('running', 'paused', 'stopped')),
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0),
  accumulated_seconds bigint not null default 0 check (accumulated_seconds >= 0),
  charged_minutes integer not null default 0 check (charged_minutes >= 0),
  started_at timestamptz,
  started_by uuid references public.profiles(id) on delete set null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_session_running_started check ((status = 'running') = (started_at is not null)),
  constraint live_session_terminal_ended check ((status = 'stopped') = (ended_at is not null))
);

create unique index if not exists live_sessions_one_active_per_gamer
  on public.live_sessions (user_id)
  where status in ('running', 'paused');

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_transaction_type_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_transaction_type_check
  check (transaction_type in ('admin_credit', 'booking_charge', 'booking_refund', 'session_charge'));
alter table public.wallet_transactions
  add column if not exists live_session_id uuid references public.live_sessions(id) on delete restrict;
alter table public.wallet_transactions
  add column if not exists session_minutes integer check (session_minutes > 0);
create unique index if not exists wallet_transactions_live_session_checkpoint
  on public.wallet_transactions (live_session_id, session_minutes)
  where live_session_id is not null;

alter table public.live_sessions enable row level security;
drop policy if exists live_sessions_admin_manage on public.live_sessions;
create policy live_sessions_admin_manage on public.live_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.live_sessions to authenticated;

create or replace function public.get_my_wallet_balance()
returns table (
  balance numeric,
  hourly_rate numeric,
  available_minutes integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(wt.amount)
      from public.wallet_transactions wt
      where wt.user_id = auth.uid()
    ), 0)::numeric(10, 2),
    setting.hourly_rate,
    greatest(0, floor((coalesce((
      select sum(wt.amount)
      from public.wallet_transactions wt
      where wt.user_id = auth.uid()
    ), 0) + 0.004999) * 60 / setting.hourly_rate)::integer)
  from public.wallet_settings setting
  where setting.singleton;
$$;

create or replace function public.get_admin_wallet_overview()
returns table (
  user_id uuid,
  game_id text,
  player_name text,
  balance numeric,
  available_minutes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  configured_rate numeric(10, 2);
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select hourly_rate into configured_rate from public.wallet_settings where singleton;
  return query
  select
    profile.id,
    profile.game_id,
    coalesce(nullif(profile.full_name, ''), profile.game_id),
    coalesce(sum(wt.amount), 0)::numeric(10, 2),
    greatest(0, floor((coalesce(sum(wt.amount), 0) + 0.004999) * 60 / configured_rate)::integer)
  from public.profiles profile
  left join public.wallet_transactions wt on wt.user_id = profile.id
  where profile.role = 'gamer'
  group by profile.id, profile.game_id, profile.full_name
  order by profile.game_id;
end;
$$;

create or replace function public.admin_set_wallet_hourly_rate(p_hourly_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_hourly_rate is null or round(p_hourly_rate, 2) < 0.60 or p_hourly_rate > 100000 then
    raise exception 'Enter a wallet conversion rate from ₹0.60 to ₹100,000 per hour';
  end if;
  update public.wallet_settings
  set hourly_rate = round(p_hourly_rate, 2), updated_at = now()
  where singleton;
end;
$$;

create or replace function public.apply_booking_wallet_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' and new.status = 'cancelled' and exists (
    select 1 from public.wallet_transactions
    where booking_id = old.id and transaction_type = 'booking_charge'
  ) then
    insert into public.wallet_transactions (user_id, booking_id, amount, transaction_type, note, created_by)
    values (old.user_id, old.id, old.total_price, 'booking_refund', 'Approved booking cancelled', auth.uid());
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_booking_status(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_booking public.bookings;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('approved', 'rejected', 'cancelled', 'completed') then
    raise exception 'Invalid booking status';
  end if;
  select * into updated_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if exists (
    select 1 from public.live_sessions
    where booking_id = p_booking_id and status in ('running', 'paused')
  ) and p_status in ('completed', 'cancelled') then
    raise exception 'Stop the live session timer before completing or cancelling this booking';
  end if;
  if not (
    (updated_booking.status = 'pending' and p_status in ('approved', 'rejected', 'cancelled'))
    or (updated_booking.status = 'approved' and p_status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid booking status transition';
  end if;
  update public.bookings set status = p_status where id = p_booking_id returning * into updated_booking;
  return updated_booking;
end;
$$;

create or replace function public.admin_start_live_session(p_booking_id uuid)
returns public.live_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  target_booking public.bookings;
  wallet_balance numeric(10, 2);
  configured_rate numeric(10, 2);
  created_session public.live_sessions;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select * into target_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if target_booking.status <> 'approved' then raise exception 'Only approved bookings can be started'; end if;
  if exists (select 1 from public.live_sessions where booking_id = p_booking_id) then
    raise exception 'A live timer has already been used for this booking';
  end if;
  perform 1 from public.profiles where id = target_booking.user_id and role = 'gamer' for update;
  if not found then raise exception 'Gamer account not found'; end if;
  if exists (
    select 1 from public.live_sessions
    where user_id = target_booking.user_id and status in ('running', 'paused')
  ) then raise exception 'This gamer already has an active session'; end if;
  if exists (
    select 1 from public.wallet_transactions
    where booking_id = target_booking.id and transaction_type = 'booking_charge'
  ) and not exists (
    select 1 from public.wallet_transactions
    where booking_id = target_booking.id and transaction_type = 'booking_refund'
  ) then
    insert into public.wallet_transactions (user_id, booking_id, amount, transaction_type, note, created_by)
    values (target_booking.user_id, target_booking.id, target_booking.total_price,
      'booking_refund', 'Reservation converted to actual-time session billing', auth.uid());
  end if;
  select coalesce(sum(amount), 0)::numeric(10, 2)
    into wallet_balance from public.wallet_transactions where user_id = target_booking.user_id;
  select hourly_rate into configured_rate from public.wallet_settings where singleton;
  if configured_rate < 0.60 then
    raise exception 'Set the wallet conversion rate to at least ₹0.60 per hour before starting live sessions';
  end if;
  if wallet_balance < round(configured_rate / 60, 2) then
    raise exception 'This gamer needs at least one minute of playtime credit to start';
  end if;

  insert into public.live_sessions (booking_id, user_id, console_id, status, hourly_rate, started_at, started_by)
  values (target_booking.id, target_booking.user_id, target_booking.console_id, 'running', configured_rate, now(), auth.uid())
  returning * into created_session;
  return created_session;
end;
$$;

create or replace function public.admin_update_live_session(p_session_id uuid, p_action text)
returns public.live_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  live_session public.live_sessions;
  wallet_balance numeric(10, 2);
  elapsed_seconds bigint;
  due_minutes integer;
  affordable_minutes integer;
  next_charged_minutes integer;
  amount_to_charge numeric(10, 2);
  accumulated_charge numeric(10, 2);
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_action not in ('sync', 'pause', 'resume', 'stop') then raise exception 'Invalid live-session action'; end if;

  select * into live_session from public.live_sessions where id = p_session_id for update;
  if not found then raise exception 'Live session not found'; end if;
  if live_session.status = 'stopped' then
    if p_action = 'stop' or p_action = 'sync' then return live_session; end if;
    raise exception 'A stopped live session cannot be resumed';
  end if;
  if p_action = 'pause' and live_session.status <> 'running' then raise exception 'Only a running session can be paused'; end if;
  if p_action = 'resume' and live_session.status <> 'paused' then raise exception 'Only a paused session can be resumed'; end if;
  if p_action = 'resume' and exists (
    select 1 from public.live_sessions
    where user_id = live_session.user_id and id <> live_session.id and status in ('running', 'paused')
  ) then raise exception 'This gamer already has another active session'; end if;

  if p_action = 'resume' then
    if live_session.hourly_rate < 0.60 then
      raise exception 'This session rate is too low for reliable minute billing';
    end if;
    perform 1 from public.profiles where id = live_session.user_id for update;
    select coalesce(sum(amount), 0)::numeric(10, 2)
      into wallet_balance from public.wallet_transactions where user_id = live_session.user_id;
    if wallet_balance < round(live_session.hourly_rate / 60, 2) then
      raise exception 'This gamer needs at least one minute of playtime credit to resume';
    end if;
    update public.live_sessions
      set status = 'running', started_at = now(), ended_at = null, updated_at = now()
      where id = p_session_id returning * into live_session;
    return live_session;
  end if;

  elapsed_seconds := live_session.accumulated_seconds;
  if live_session.status = 'running' then
    elapsed_seconds := elapsed_seconds + greatest(0, floor(extract(epoch from (now() - live_session.started_at))))::bigint;
  end if;
  due_minutes := floor(elapsed_seconds / 60.0)::integer;
  perform 1 from public.profiles where id = live_session.user_id for update;
  select coalesce(sum(amount), 0)::numeric(10, 2)
    into wallet_balance from public.wallet_transactions where user_id = live_session.user_id;

  affordable_minutes := greatest(
    0,
    floor((wallet_balance + round(live_session.hourly_rate * live_session.charged_minutes / 60.0, 2) + 0.005)
      * 60 / live_session.hourly_rate)::integer - live_session.charged_minutes
  );
  next_charged_minutes := greatest(live_session.charged_minutes, least(due_minutes, live_session.charged_minutes + affordable_minutes));
  amount_to_charge := round(live_session.hourly_rate * next_charged_minutes / 60.0, 2)
    - round(live_session.hourly_rate * live_session.charged_minutes / 60.0, 2);

  if next_charged_minutes > live_session.charged_minutes then
    if amount_to_charge > wallet_balance then
      next_charged_minutes := greatest(live_session.charged_minutes,
        next_charged_minutes - 1);
      amount_to_charge := round(live_session.hourly_rate * next_charged_minutes / 60.0, 2)
        - round(live_session.hourly_rate * live_session.charged_minutes / 60.0, 2);
    end if;
    if amount_to_charge > 0 then
      insert into public.wallet_transactions
        (user_id, amount, transaction_type, note, created_by, live_session_id, session_minutes)
      values
        (live_session.user_id, -amount_to_charge, 'session_charge',
         format('Live session charge · %s complete minute(s)', next_charged_minutes - live_session.charged_minutes),
         auth.uid(), live_session.id, next_charged_minutes);
    end if;
    update public.live_sessions
      set charged_minutes = next_charged_minutes, updated_at = now()
      where id = p_session_id returning * into live_session;
  end if;

  accumulated_charge := round(live_session.hourly_rate * live_session.charged_minutes / 60.0, 2);
  if p_action = 'stop' or due_minutes > live_session.charged_minutes then
    update public.live_sessions
      set status = 'stopped',
          started_at = null,
          accumulated_seconds = charged_minutes * 60,
          ended_at = now(),
          updated_at = now()
      where id = p_session_id returning * into live_session;
    update public.bookings
      set status = 'completed', total_price = accumulated_charge
      where id = live_session.booking_id and status = 'approved';
  elsif p_action = 'pause' then
    update public.live_sessions
      set status = 'paused', started_at = null, accumulated_seconds = elapsed_seconds, updated_at = now()
      where id = p_session_id returning * into live_session;
  end if;

  return live_session;
end;
$$;

revoke all on function public.admin_start_live_session(uuid) from public;
revoke all on function public.admin_update_live_session(uuid, text) from public;
grant execute on function public.admin_start_live_session(uuid) to authenticated;
grant execute on function public.admin_update_live_session(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.live_sessions;
exception when duplicate_object or undefined_object then
  null;
end;
$$;
