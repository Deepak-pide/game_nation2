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

delete from public.games;
