alter table public.music_catalog
  add column if not exists spotify_track_id varchar(32),
  add column if not exists spotify_streams bigint,
  add column if not exists spotify_checked_at timestamptz,
  add column if not exists spotify_source varchar(32);

create index if not exists music_catalog_spotify_track_idx
  on public.music_catalog (spotify_track_id)
  where spotify_track_id is not null;
