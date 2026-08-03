import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(1);
try {
  const years = await database<Array<{
    release_year: number;
    target_count: number;
    actual_count: number;
    ready_count: number;
    with_video: number;
    with_knownness: number;
    with_embedding: number;
  }>>`
    select targets.release_year, targets.target_count,
      count(catalog.id)::int as actual_count,
      count(catalog.id) filter (where catalog.catalog_status = 'ready')::int as ready_count,
      count(catalog.id) filter (where catalog.youtube_video_id is not null)::int as with_video,
      count(catalog.id) filter (where catalog.knownness_score is not null)::int as with_knownness,
      count(catalog.id) filter (where catalog.embedding is not null)::int as with_embedding
    from public.music_catalog_year_targets targets
    left join public.music_catalog catalog on catalog.release_year = targets.release_year
    where targets.release_year between 1980 and 2026
    group by targets.release_year, targets.target_count
    order by targets.release_year
  `;
  years.forEach((year) => console.info(
    `${year.release_year}: ${year.actual_count}/${year.target_count} | ` +
    `video=${year.with_video} knownness=${year.with_knownness} embedding=${year.with_embedding} ready=${year.ready_count}`,
  ));
  const totals = years.reduce((result, year) => ({
    actual: result.actual + year.actual_count,
    target: result.target + year.target_count,
    ready: result.ready + year.ready_count,
    video: result.video + year.with_video,
    knownness: result.knownness + year.with_knownness,
    embedding: result.embedding + year.with_embedding,
  }), { actual: 0, target: 0, ready: 0, video: 0, knownness: 0, embedding: 0 });
  console.info(`[TOTAL] ${JSON.stringify(totals)}`);
  console.info(
    `[FALTANTES] ${years.filter((year) => year.actual_count < year.target_count)
      .map((year) => year.release_year).join(",") || "ninguno"}`,
  );
} finally {
  await database.end();
}
