create table if not exists public.music_room_runtime_states (
  room_code text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists music_room_runtime_states_updated_at_idx
  on public.music_room_runtime_states (updated_at desc);

alter table public.music_room_runtime_states enable row level security;

comment on table public.music_room_runtime_states is
  'Estado durable de partidas musicales para sobrevivir reinicios del backend.';
