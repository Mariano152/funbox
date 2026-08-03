-- Permite filtrar popularidad y vistas antes de gastar llamadas en metadatos.
alter table public.music_success_candidates
  alter column release_year drop not null;

