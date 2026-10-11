create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  console_id uuid not null references public.consoles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.console_status (
  device_id uuid primary key references public.devices(id) on delete cascade,
  console_id uuid not null references public.consoles(id) on delete cascade,
  status text not null check (status in ('online', 'offline', 'maintenance')),
  reported_at timestamptz not null default now()
);

alter table public.devices enable row level security;
alter table public.console_status enable row level security;

drop policy if exists devices_admin_manage on public.devices;
create policy devices_admin_manage on public.devices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists console_status_admin_read on public.console_status;
create policy console_status_admin_read on public.console_status
  for select to authenticated using (public.is_admin());

grant select, insert, update, delete on public.devices to authenticated;
grant select on public.console_status to authenticated;