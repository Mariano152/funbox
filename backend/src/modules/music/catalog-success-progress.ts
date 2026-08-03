import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(1);
try {
  const jobs = await database<Array<{
    id: string; status: string; current_year: number | null;
    from_year: number; to_year: number; target_per_year: number;
    candidates_discovered: number; candidates_checked: number; successes_added: number;
    heartbeat_at: Date;
  }>>`
    select id, status, current_year, from_year, to_year, target_per_year, candidates_discovered, candidates_checked,
      successes_added, heartbeat_at
    from public.music_success_fill_jobs
    order by started_at desc limit 3
  `;
  jobs.forEach((job) => console.info(
    `[Éxitos][TRABAJO] id=${job.id} estado=${job.status} modo=${job.current_year == null ? "global" : `año-${job.current_year}`} ` +
    `meta=${job.target_per_year} rango=${job.from_year}-${job.to_year} ` +
    `descubiertas=${job.candidates_discovered} revisadas=${job.candidates_checked} ` +
    `agregadas=${job.successes_added} heartbeat=${job.heartbeat_at.toISOString()}`,
  ));
  const years = await database<Array<{
    release_year: number;
    successful: number;
    discovered: number;
    checked: number;
  }>>`
    select years.release_year,
      count(distinct catalog.youtube_video_id) filter (where catalog.youtube_views > 50000000)::int as successful,
      count(distinct candidates.normalized_key)::int as discovered,
      count(distinct candidates.normalized_key) filter
        (where candidates.status in ('accepted', 'rejected', 'error'))::int as checked
    from generate_series(1980, 2026) years(release_year)
    left join public.music_catalog catalog on catalog.release_year = years.release_year
    left join public.music_success_candidates candidates on candidates.release_year = years.release_year
    group by years.release_year order by years.release_year
  `;
  const globalMode = jobs[0]?.current_year == null;
  years.forEach((year) => console.info(
    `[Éxitos][PROGRESO] año=${year.release_year} exitosas=${year.successful}${globalMode ? "" : "/100"} ` +
    `candidatas=${year.discovered} revisadas=${year.checked}`,
  ));
  const [{ total }] = await database<Array<{ total: number }>>`
    select count(distinct youtube_video_id)::int as total
    from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
  `;
  const activeTarget = jobs[0]?.target_per_year ?? 2_500;
  console.info(`[Éxitos][TOTAL] exitosas=${total}/${activeTarget} faltantes=${Math.max(0, activeTarget - total)}`);
  const [quality] = await database<Array<{
    valid: number; missing_video_id: number; missing_checked_at: number;
    missing_knownness: number; missing_genre: number; duplicate_video_ids: number;
  }>>`
    with eligible as (
      select * from public.music_catalog
      where release_year between 1980 and 2026 and youtube_views > 50000000
    ), duplicate_ids as (
      select youtube_video_id from eligible where youtube_video_id is not null
      group by youtube_video_id having count(*) > 1
    )
    select count(*)::int as valid,
      count(*) filter (where youtube_video_id is null)::int as missing_video_id,
      count(*) filter (where youtube_checked_at is null)::int as missing_checked_at,
      count(*) filter (where knownness_score is null)::int as missing_knownness,
      count(*) filter (where primary_genre is null or cardinality(genres) = 0)::int as missing_genre,
      (select count(*)::int from duplicate_ids) as duplicate_video_ids
    from eligible
  `;
  console.info(`[Éxitos][CALIDAD] válidas=${quality?.valid ?? 0} ` +
    `sinVideoId=${quality?.missing_video_id ?? 0} sinFechaYouTube=${quality?.missing_checked_at ?? 0} ` +
    `sinKnownness=${quality?.missing_knownness ?? 0} sinGénero=${quality?.missing_genre ?? 0} ` +
    `videoIdsDuplicados=${quality?.duplicate_video_ids ?? 0}`);
} finally {
  await database.end();
}
