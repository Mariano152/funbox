-- Ningún DJ puede ser líder. El siguiente jugador por orden de entrada
-- toma el liderazgo; si todavía no existe, el próximo jugador nuevo lo hará.
update public.room_players
set is_host = false
where is_dj = true and is_host = true;

with candidates as (
  select
    p.id,
    row_number() over (partition by p.room_id order by p.joined_at, p.id) as position
  from public.room_players p
  where p.is_dj = false
    and not exists (
      select 1
      from public.room_players leader
      where leader.room_id = p.room_id and leader.is_host = true
    )
)
update public.room_players player
set is_host = true
from candidates
where player.id = candidates.id and candidates.position = 1;
