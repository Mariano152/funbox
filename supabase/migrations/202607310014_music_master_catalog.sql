-- Convierte music_catalog en el catÃ¡logo maestro curado y auditable.
create table public.music_catalog_import_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_from_year integer not null,
  requested_to_year integer not null,
  modern_target integer not null default 1000,
  legacy_target integer not null default 500,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  imported_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.music_catalog_year_targets (
  release_year integer primary key,
  target_count integer not null check (target_count > 0),
  imported_count integer not null default 0,
  ready_count integer not null default 0,
  metadata_completed_at timestamptz,
  enrichment_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.music_catalog
  add column if not exists primary_genre text,
  add column if not exists isrcs text[] not null default '{}',
  add column if not exists source_names text[] not null default '{}',
  add column if not exists source_score real,
  add column if not exists semantic_description text,
  add column if not exists catalog_status text not null default 'metadata_only',
  add column if not exists video_embeddable boolean,
  add column if not exists video_verified_at timestamptz,
  add column if not exists embedding_status text not null default 'pending',
  add column if not exists enrichment_error text,
  add column if not exists import_job_id uuid references public.music_catalog_import_jobs(id);

alter table public.music_catalog
  add constraint music_catalog_status_check
    check (catalog_status in ('metadata_only', 'pending_video', 'pending_metrics', 'pending_embedding', 'ready', 'rejected')),
  add constraint music_catalog_embedding_status_check
    check (embedding_status in ('pending', 'ready', 'failed'));

create index if not exists music_catalog_recording_mbid_idx
  on public.music_catalog (musicbrainz_recording_id)
  where musicbrainz_recording_id is not null;

create index if not exists music_catalog_master_filters_idx
  on public.music_catalog (release_year, primary_genre, language, catalog_status);

create index if not exists music_catalog_video_pending_idx
  on public.music_catalog (catalog_status, release_year)
  where youtube_video_id is null;

insert into public.music_catalog_year_targets (release_year, target_count)
select year, case when year >= 2020 then 1000 else 500 end
from generate_series(1980, 2026) as year
on conflict (release_year) do update set
  target_count = excluded.target_count,
  updated_at = now();
