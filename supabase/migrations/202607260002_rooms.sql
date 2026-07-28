-- Rooms: una sala es la unidad principal de una fiesta.
create type public.room_status as enum ('lobby', 'playing', 'finished');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(4) not null unique check (code ~ '^[A-Z]{4}$'),
  status public.room_status not null default 'lobby',
  host_token_hash text not null,
  current_game_key text,
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index rooms_status_idx on public.rooms (status);
create index rooms_created_at_idx on public.rooms (created_at desc);

alter table public.rooms enable row level security;

comment on column public.rooms.host_token_hash is
  'Hash del token secreto del anfitrión. Nunca guardar ni devolver el token original.';
comment on column public.rooms.game_state is
  'Snapshot recuperable; el estado de alta frecuencia vivirá en memoria/Redis.';
