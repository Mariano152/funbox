create table if not exists public.music_prompt_embeddings (
  prompt_key text not null,
  prompt_text text not null,
  semantic_text text not null,
  embedding_model text not null,
  embedding_task text not null,
  embedding real[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prompt_key, embedding_model, embedding_task)
);

create index if not exists music_prompt_embeddings_updated_idx
  on public.music_prompt_embeddings (updated_at desc);
