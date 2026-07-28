-- Players: invitados temporales asociados a una sala.
create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  nickname varchar(16) not null check (length(trim(nickname)) between 1 and 16),
  avatar_color varchar(16) not null
    check (avatar_color in ('cyan', 'purple', 'pink', 'lime')),
  avatar_config jsonb not null default '{}'::jsonb,
  reconnect_token_hash text not null,
  is_host boolean not null default false,
  is_connected boolean not null default true,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, nickname)
);

create index room_players_room_id_idx on public.room_players (room_id);
create index room_players_connected_idx
  on public.room_players (room_id, is_connected)
  where is_connected = true;

alter table public.room_players enable row level security;

comment on column public.room_players.reconnect_token_hash is
  'Hash del token usado para recuperar la identidad después de una desconexión.';
