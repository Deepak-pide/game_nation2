alter table public.admin_quick_start_sessions
  add column if not exists duration_minutes integer not null default 40
    check (duration_minutes between 1 and 1440);
