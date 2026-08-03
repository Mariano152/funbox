-- Los embeddings se calculan/comparan durante la selecciÃ³n; no bloquean la
-- disponibilidad de una canciÃ³n que ya tiene video y mÃ©tricas completas.
update public.music_catalog set catalog_status = 'ready', updated_at = now()
where youtube_video_id is not null
  and youtube_views is not null
  and spotify_streams is not null
  and knownness_score is not null;
