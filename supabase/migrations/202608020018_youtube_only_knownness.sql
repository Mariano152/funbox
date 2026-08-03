-- Spotify deja de formar parte de elegibilidad y Knownness. Sus columnas se
-- conservan únicamente como datos históricos para no destruir información.
update public.music_catalog set
  total_plays = youtube_views,
  knownness_confidence = case when youtube_views is null then 0 else 100 end,
  knownness_score = case
    when youtube_views is null or youtube_views < 50000000 then 0
    else round((least(1.0, greatest(0.0,
      ln(youtube_views::numeric / 50000000) / ln(10000000000::numeric / 50000000)
    )) * 100)::numeric, 1)
  end,
  catalog_status = case
    when youtube_video_id is not null and youtube_views >= 50000000 then 'ready'
    else 'pending_metrics'
  end,
  updated_at = now();

create or replace view public.music_catalog_enrichment_progress as
select
  count(*)::integer as total_tracks,
  count(*) filter (where video_lookup_status <> 'pending')::integer as reviewed_tracks,
  count(*) filter (where youtube_video_id is not null)::integer as youtube_ids_found,
  count(*) filter (where youtube_views is not null)::integer as youtube_metrics_found,
  0::integer as spotify_streams_found,
  count(*) filter (where knownness_score is not null)::integer as knownness_calculated,
  count(*) filter (where catalog_status = 'ready')::integer as ready_tracks,
  count(*) filter (where video_lookup_status = 'pending')::integer as pending_tracks,
  count(*) filter (where video_lookup_status = 'error')::integer as error_tracks
from public.music_catalog
where release_year between 1980 and 2026;
