insert into public.profiles (id, email, full_name, role)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  'admin'
from auth.users u
where lower(u.email) = 'dg3667610@gmail.com'
on conflict (id) do update
  set email = excluded.email,
      role = 'admin';