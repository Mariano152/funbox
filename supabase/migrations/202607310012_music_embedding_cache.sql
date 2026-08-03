alter table public.music_catalog
  add column if not exists embedding_model text,
  add column if not exists embedding_task text,
  add column if not exists embedding_description_hash text,
  add column if not exists embedding real[],
  add column if not exists embedding_updated_at timestamptz;

create index if not exists music_catalog_embedding_lookup_idx
  on public.music_catalog (embedding_model, embedding_task)
  where embedding is not null;
