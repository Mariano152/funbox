-- Adivina la canción: un jugador puede ocupar la cabina DJ.
alter table public.room_players
  add column is_dj boolean not null default false;

create unique index room_players_single_dj_per_room
  on public.room_players (room_id)
  where is_dj = true;
