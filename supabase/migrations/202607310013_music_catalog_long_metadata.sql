-- MusicBrainz puede devolver créditos con muchos colaboradores y títulos largos.
alter table public.music_catalog
  alter column title type text,
  alter column artist type text;

alter table public.music_apple_chart_observations
  alter column title type text,
  alter column artist type text;
