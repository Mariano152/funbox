import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(1);
try {
  const [stats] = await database<[{ total: number; models: number }]>`
    select
      count(*) filter (where embedding is not null)::int as total,
      count(distinct embedding_model) filter (where embedding is not null)::int as models
    from public.music_catalog
  `;
  console.info(`[Embeddings caché] ${stats.total} canciones persistidas; ${stats.models} modelo(s).`);
  const knownness = await database<Array<{
    title: string;
    artist: string;
    genres: string[] | null;
    score: number;
  }>>`
    select title, artist, genres, knownness_score::float as score
    from public.music_catalog
    where knownness_confidence > 0 and knownness_score is not null
    order by knownness_score desc
    limit 30
  `;
  console.info("[Knownness caché] muestra:", knownness);
  const opalite = await database`
    select title, artist, release_year, youtube_views,
      youtube_video_id, youtube_published_at, youtube_checked_at,
      knownness_score, knownness_confidence
    from public.music_catalog
    where lower(title) = 'opalite'
  `;
  console.info("[Diagnóstico Opalite]", opalite);
} finally {
  await database.end();
}
