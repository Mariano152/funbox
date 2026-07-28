-- Players: catálogo exclusivo de personajes por sala.
alter table public.room_players
  add column avatar_key varchar(24);

with numbered_players as (
  select
    id,
    row_number() over (partition by room_id order by joined_at, id) as position
  from public.room_players
)
update public.room_players p
set avatar_key = (
  array[
    'nerd', 'athlete', 'royal', 'gardener', 'rocker',
    'astronaut', 'chef', 'detective', 'artist'
  ]
)[numbered_players.position]
from numbered_players
where p.id = numbered_players.id;

alter table public.room_players
  alter column avatar_key set not null,
  add constraint room_players_avatar_key_check
    check (avatar_key in (
      'nerd', 'athlete', 'royal', 'gardener', 'rocker',
      'astronaut', 'chef', 'detective', 'artist'
    )),
  drop constraint room_players_avatar_color_check,
  add constraint room_players_avatar_color_check
    check (avatar_color in (
      'cyan', 'pink', 'purple', 'lime', 'orange',
      'blue', 'red', 'yellow', 'teal'
    ));

create unique index room_players_unique_avatar_per_room
  on public.room_players (room_id, avatar_key);
