create table if not exists public.quick_booking_sessions (
  id uuid primary key default gen_random_uuid(),
  quick_booking_id uuid not null unique references public.quick_bookings(id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'paused', 'stopped')),
  accumulated_seconds bigint not null default 0 check (accumulated_seconds >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_booking_session_running_started check ((status = 'running') = (started_at is not null)),
  constraint quick_booking_session_terminal_ended check ((status = 'stopped') = (ended_at is not null))
);

alter table public.quick_booking_sessions enable row level security;

drop policy if exists quick_booking_sessions_admin_read on public.quick_booking_sessions;
create policy quick_booking_sessions_admin_read on public.quick_booking_sessions
  for select to authenticated using (public.is_admin());

grant select on public.quick_booking_sessions to authenticated;

create or replace function public.admin_update_quick_booking_session(p_quick_booking_id uuid, p_action text)
returns public.quick_booking_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  current_session public.quick_booking_sessions;
  updated_session public.quick_booking_sessions;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_action is null or p_action not in ('start', 'pause', 'resume', 'stop') then
    raise exception 'Invalid Quick Book timer action';
  end if;
  if not exists (
    select 1 from public.quick_bookings
    where id = p_quick_booking_id
  ) then
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
    insert into public.quick_booking_sessions (quick_booking_id, status, started_at)
    values (p_quick_booking_id, 'running', now())
    returning * into updated_session;
    return updated_session;
  end if;

  if current_session.status = 'stopped' then
    raise exception 'This Quick Book timer has already stopped';
  end if;

  if p_action = 'start' then
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
       set status = 'running',
           started_at = now(),
           updated_at = now()
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

revoke all on function public.admin_update_quick_booking_session(uuid, text) from public;
grant execute on function public.admin_update_quick_booking_session(uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.quick_booking_sessions;
exception when duplicate_object or undefined_object then
  null;
end;
$$;
