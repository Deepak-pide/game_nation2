create table if not exists public.wallet_settings (
  singleton boolean primary key default true check (singleton),
  hourly_rate numeric(10, 2) not null default 80 check (hourly_rate > 0),
  updated_at timestamptz not null default now()
);

insert into public.wallet_settings (singleton, hourly_rate)
values (true, 80)
on conflict (singleton) do nothing;

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  amount numeric(10, 2) not null check (amount <> 0),
  transaction_type text not null check (transaction_type in ('admin_credit', 'booking_charge', 'booking_refund')),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint wallet_transaction_booking_type_once unique (booking_id, transaction_type)
);

create index if not exists wallet_transactions_user_created_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_settings enable row level security;
alter table public.wallet_transactions enable row level security;

drop policy if exists wallet_settings_admin_read on public.wallet_settings;
create policy wallet_settings_admin_read on public.wallet_settings
  for select to authenticated using (public.is_admin());
drop policy if exists wallet_settings_authenticated_read on public.wallet_settings;
create policy wallet_settings_authenticated_read on public.wallet_settings
  for select to authenticated using (true);
drop policy if exists wallet_transactions_owner_or_admin_read on public.wallet_transactions;
create policy wallet_transactions_owner_or_admin_read on public.wallet_transactions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

revoke all on public.wallet_settings, public.wallet_transactions from public, anon, authenticated;
grant select on public.wallet_settings, public.wallet_transactions to authenticated;
revoke all on sequence public.wallet_transactions_id_seq from public, anon, authenticated;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 100),
  mode text not null check (mode in ('solo', 'duo', 'squad')),
  image_url text not null default '',
  rating numeric(2, 1) not null default 4.5 check (rating between 1 and 5),
  description text not null default '',
  youtube_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'games' and column_name = 'description'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'games' and column_name = 'youtube_url'
  ) then
    delete from public.games;
  end if;
end;
$$;

alter table public.games
  add column if not exists description text not null default '',
  add column if not exists youtube_url text not null default '';

alter table public.games
  drop constraint if exists games_youtube_url_check;

alter table public.games
  add constraint games_youtube_url_check
  check (
    youtube_url = ''
    or youtube_url ~* '^https?://(www\.)?(youtube\.com|youtu\.be)/'
  );

create unique index if not exists games_title_case_unique on public.games (lower(title));
create index if not exists games_active_mode_idx on public.games (active, mode, title);
alter table public.games enable row level security;

drop policy if exists games_public_read on public.games;
drop policy if exists games_public_read_anon on public.games;
create policy games_public_read_anon on public.games
  for select to anon using (active);
drop policy if exists games_read_authenticated on public.games;
create policy games_read_authenticated on public.games
  for select to authenticated using (active or public.is_admin());
drop policy if exists games_admin_manage on public.games;
create policy games_admin_manage on public.games
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.games to anon, authenticated;
grant insert, update, delete on public.games to authenticated;

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
    floor(coalesce((
      select sum(wt.amount)
      from public.wallet_transactions wt
      where wt.user_id = auth.uid()
    ), 0) * 60 / setting.hourly_rate)::integer
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
    floor(coalesce(sum(wt.amount), 0) * 60 / configured_rate)::integer
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
  if p_hourly_rate is null or round(p_hourly_rate, 2) <= 0 or p_hourly_rate > 100000 then
    raise exception 'Enter a wallet conversion rate greater than zero';
  end if;
  update public.wallet_settings
  set hourly_rate = round(p_hourly_rate, 2), updated_at = now()
  where singleton;
end;
$$;

create or replace function public.admin_add_wallet_credit(
  p_user_id uuid,
  p_amount numeric,
  p_note text default ''
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric(10, 2);
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if p_amount is null or round(p_amount, 2) <= 0 or p_amount > 1000000 then
    raise exception 'Credit amount must be greater than zero';
  end if;

  perform 1 from public.profiles
  where id = p_user_id and role = 'gamer'
  for update;
  if not found then raise exception 'Gamer account not found'; end if;

  insert into public.wallet_transactions (user_id, amount, transaction_type, note, created_by)
  values (p_user_id, round(p_amount, 2), 'admin_credit', left(coalesce(p_note, ''), 240), auth.uid());

  select coalesce(sum(amount), 0)::numeric(10, 2) into new_balance
  from public.wallet_transactions where user_id = p_user_id;
  return new_balance;
end;
$$;

create or replace function public.apply_booking_wallet_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_balance numeric(10, 2);
begin
  if old.status = 'pending' and new.status = 'approved' then
    if new.total_price > 0 then
      perform 1 from public.profiles where id = new.user_id for update;
      select coalesce(sum(amount), 0)::numeric(10, 2) into wallet_balance
      from public.wallet_transactions where user_id = new.user_id;

      if wallet_balance < new.total_price then
        raise exception 'Insufficient wallet credit. Add credit before approving this booking.';
      end if;

      insert into public.wallet_transactions (user_id, booking_id, amount, transaction_type, note, created_by)
      values (new.user_id, new.id, -new.total_price, 'booking_charge', 'Booking approved', auth.uid());
    end if;
  elsif old.status = 'approved' and new.status = 'cancelled' and exists (
    select 1 from public.wallet_transactions
    where booking_id = old.id and transaction_type = 'booking_charge'
  ) then
    insert into public.wallet_transactions (user_id, booking_id, amount, transaction_type, note, created_by)
    values (old.user_id, old.id, old.total_price, 'booking_refund', 'Approved booking cancelled', auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists booking_wallet_charge on public.bookings;
create trigger booking_wallet_charge
  before update of status on public.bookings
  for each row
  when (old.status is distinct from new.status)
  execute function public.apply_booking_wallet_charge();

revoke all on function public.get_my_wallet_balance() from public;
revoke all on function public.get_admin_wallet_overview() from public;
revoke all on function public.admin_set_wallet_hourly_rate(numeric) from public;
revoke all on function public.admin_add_wallet_credit(uuid, numeric, text) from public;
grant execute on function public.get_my_wallet_balance() to authenticated;
grant execute on function public.get_admin_wallet_overview() to authenticated;
grant execute on function public.admin_set_wallet_hourly_rate(numeric) to authenticated;
grant execute on function public.admin_add_wallet_credit(uuid, numeric, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.games;
exception when duplicate_object or undefined_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.wallet_transactions;
exception when duplicate_object or undefined_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.wallet_settings;
exception when duplicate_object or undefined_object then
  null;
end;
$$;
