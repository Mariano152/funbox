-- Game engine: historial permanente y snapshots de partidas/rondas.
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  status varchar(16) not null default 'active'
    check (status in ('active', 'finished', 'abandoned')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  game_key text not null,
  round_number integer not null check (round_number > 0),
  phase text not null,
  public_state jsonb not null default '{}'::jsonb,
  private_state jsonb not null default '{}'::jsonb,
  deadline_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (session_id, round_number)
);

create index game_sessions_room_id_idx on public.game_sessions (room_id);
create index game_rounds_session_id_idx on public.game_rounds (session_id);

alter table public.game_sessions enable row level security;
alter table public.game_rounds enable row level security;
