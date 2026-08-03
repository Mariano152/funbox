-- Knownness de YouTube alcanza 100 en 5 mil millones de vistas y se mantiene
-- saturado en 100 por encima de ese techo.
update public.music_catalog set
  total_plays = youtube_views,
  knownness_confidence = case when youtube_views is null then 0 else 100 end,
  knownness_score = case
    when youtube_views is null or youtube_views < 50000000 then 0
    else round((least(1.0, greatest(0.0,
      ln(youtube_views::numeric / 50000000) / ln(5000000000::numeric / 50000000)
    )) * 100)::numeric, 1)
  end,
  updated_at = now();
