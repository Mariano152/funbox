create table if not exists public.music_success_fill_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'completed', 'exhausted', 'quota', 'failed')),
  from_year integer not null,
  to_year integer not null,
  target_per_year integer not null default 100,
  current_year integer,
  candidates_discovered integer not null default 0,
  candidates_checked integer not null default 0,
  successes_added integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.music_success_candidates (
  normalized_key text primary key,
  title text not null,
  artist text not null,
  release_year integer not null,
  primary_genre text,
  musicbrainz_recording_id uuid,
  musicbrainz_artist_id uuid,
  source_score real,
  listenbrainz_users integer,
  listenbrainz_listens bigint,
  youtube_video_id varchar(16),
  youtube_views bigint,
  status text not null default 'discovered'
    check (status in ('discovered', 'prioritized', 'id_found', 'accepted', 'rejected', 'error')),
  attempts integer not null default 0,
  last_error text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists music_success_candidates_queue_idx
  on public.music_success_candidates (release_year, status, listenbrainz_users desc nulls last);
