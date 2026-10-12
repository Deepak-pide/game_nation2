alter table public.live_sessions
  add column if not exists last_heartbeat_at timestamptz;

update public.live_sessions
set last_heartbeat_at = coalesce(updated_at, started_at, now())
where status = 'running'
  and last_heartbeat_at is null;

create or replace function public.set_live_session_heartbeat()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'running' then
      new.last_heartbeat_at := now();
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'running' then
      new.last_heartbeat_at := now();
    else
      new.last_heartbeat_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists live_session_heartbeat_state on public.live_sessions;
create trigger live_session_heartbeat_state
  before insert or update of status on public.live_sessions
  for each row execute function public.set_live_session_heartbeat();

create or replace function public.admin_heartbeat_live_session(
  p_session_id uuid,
  p_force_pause boolean default false
)
returns public.live_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  live_session public.live_sessions;
  running_elapsed interval;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  select * into live_session
  from public.live_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'Live session not found';
  end if;
  if live_session.status <> 'running' then
    return live_session;
  end if;

  if p_force_pause
    or (live_session.last_heartbeat_at is not null
      and now() - live_session.last_heartbeat_at > interval '45 seconds') then
    running_elapsed := greatest(interval '0 seconds', live_session.last_heartbeat_at - live_session.started_at);
    update public.live_sessions
    set started_at = now() - running_elapsed,
        updated_at = now()
    where id = p_session_id;

    return public.admin_update_live_session(p_session_id, 'pause');
  end if;

  update public.live_sessions
  set last_heartbeat_at = now()
  where id = p_session_id
  returning * into live_session;
  return live_session;
end;
$$;

revoke all on function public.admin_heartbeat_live_session(uuid, boolean) from public;
grant execute on function public.admin_heartbeat_live_session(uuid, boolean) to authenticated;
