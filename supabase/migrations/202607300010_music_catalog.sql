-- Catálogo incremental y señales de popularidad para selección musical.
create table public.music_catalog (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  title varchar(200) not null,
  artist varchar(200) not null,
  musicbrainz_recording_id uuid,
  musicbrainz_artist_id uuid,
  release_year integer,
  genres text[] not null default '{}',
  tags text[] not null default '{}',
  language varchar(24),
  listenbrainz_listens bigint,
  listenbrainz_users bigint,
  artist_listens bigint,
  artist_users bigint,
  apple_best_rank integer,
  apple_market_count integer,
  apple_days_in_chart integer,
  youtube_video_id varchar(20),
  youtube_views bigint,
  youtube_published_at timestamptz,
  youtube_previous_views bigint,
  youtube_previous_checked_at timestamptz,
  youtube_checked_at timestamptz,
  knownness_score real,
  knownness_confidence real,
  metadata_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index music_catalog_filters_idx
  on public.music_catalog (release_year, language);

create index music_catalog_knownness_idx
  on public.music_catalog (knownness_score desc nulls last);

create table public.music_apple_chart_observations (
  observed_on date not null default current_date,
  storefront varchar(8) not null,
  normalized_key text not null,
  rank integer not null,
  title varchar(200) not null,
  artist varchar(200) not null,
  release_year integer,
  primary key (observed_on, storefront, normalized_key)
);

create index music_apple_chart_track_idx
  on public.music_apple_chart_observations (normalized_key, observed_on desc);
