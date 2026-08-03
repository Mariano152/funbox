import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(1);
try {
  const [progress] = await database<Array<Record<string, number>>>`
    select * from public.music_catalog_enrichment_progress
  `;
  const [job] = await database<Array<{
    id: string; status: string; reviewed_tracks: number; total_tracks: number;
    current_year: number | null; current_track: string | null; heartbeat_at: Date;
    youtube_ids_found: number; ready_tracks: number;
    error_count: number; last_error: string | null;
  }>>`
    select id, status, reviewed_tracks, total_tracks, current_year, current_track,
      heartbeat_at, youtube_ids_found, ready_tracks,
      error_count, last_error
    from public.music_catalog_enrichment_jobs
    order by started_at desc limit 1
  `;
  const percent = progress.total_tracks
    ? progress.reviewed_tracks / progress.total_tracks * 100 : 0;
  console.info(`[PROGRESO TOTAL] ${progress.reviewed_tracks}/${progress.total_tracks} (${percent.toFixed(2)}%)`);
  console.info(JSON.stringify(progress, null, 2));
  console.info(`[TRABAJO ACTUAL] ${JSON.stringify(job ?? null, null, 2)}`);
} finally {
  await database.end();
}
