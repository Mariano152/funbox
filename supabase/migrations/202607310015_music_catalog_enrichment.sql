create table public.music_catalog_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'stopped')),
  from_year integer not null default 2026,
  to_year integer not null default 1980,
  total_tracks integer not null default 0,
  reviewed_tracks integer not null default 0,
  youtube_ids_found integer not null default 0,
  youtube_metrics_found integer not null default 0,
  spotify_streams_found integer not null default 0,
  knownness_calculated integer not null default 0,
  ready_tracks integer not null default 0,
  current_year integer,
  current_track text,
  error_count integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.music_catalog
  add column if not exists youtube_url text,
  add column if not exists total_plays bigint,
  add column if not exists video_lookup_status text not null default 'pending',
  add column if not exists video_lookup_checked_at timestamptz,
  add column if not exists spotify_lookup_status text not null default 'pending',
  add column if not exists spotify_lookup_checked_at timestamptz,
  add column if not exists enrichment_attempts integer not null default 0,
  add column if not exists enrichment_job_id uuid references public.music_catalog_enrichment_jobs(id);

alter table public.music_catalog
  add constraint music_catalog_video_lookup_status_check
    check (video_lookup_status in ('pending', 'found', 'not_found', 'error')),
  add constraint music_catalog_spotify_lookup_status_check
    check (spotify_lookup_status in ('pending', 'found', 'not_found', 'error'));

update public.music_catalog set
  youtube_url = case when youtube_video_id is not null
    then 'https://www.youtube.com/watch?v=' || youtube_video_id else youtube_url end,
  video_lookup_status = case when youtube_video_id is not null then 'found' else video_lookup_status end,
  spotify_lookup_status = case when spotify_streams is not null then 'found' else spotify_lookup_status end,
  total_plays = case
    when spotify_streams is not null then coalesce(youtube_views, 0) + spotify_streams
    when youtube_views is not null then youtube_views * 3
    else total_plays
  end;

create index if not exists music_catalog_enrichment_queue_idx
  on public.music_catalog (release_year desc, video_lookup_status, spotify_lookup_status);

create or replace view public.music_catalog_enrichment_progress as
select
  count(*)::integer as total_tracks,
  count(*) filter (where video_lookup_status <> 'pending' or spotify_lookup_status <> 'pending')::integer as reviewed_tracks,
  count(*) filter (where youtube_video_id is not null)::integer as youtube_ids_found,
  count(*) filter (where youtube_views is not null)::integer as youtube_metrics_found,
  count(*) filter (where spotify_streams is not null)::integer as spotify_streams_found,
  count(*) filter (where knownness_score is not null)::integer as knownness_calculated,
  count(*) filter (where catalog_status = 'ready')::integer as ready_tracks,
  count(*) filter (where video_lookup_status = 'pending' or spotify_lookup_status = 'pending')::integer as pending_tracks,
  count(*) filter (where video_lookup_status = 'error' or spotify_lookup_status = 'error')::integer as error_tracks
from public.music_catalog
where release_year between 1980 and 2026;
