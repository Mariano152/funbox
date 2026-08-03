-- Historial musical para evitar repeticiones entre rondas y partidas.
create table public.music_track_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  category varchar(32) not null,
  title varchar(160) not null,
  artist varchar(160) not null,
  selected_at timestamptz not null default now()
);

create index music_track_history_recent_idx
  on public.music_track_history (category, selected_at desc);

