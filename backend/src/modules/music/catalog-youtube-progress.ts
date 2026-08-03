import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "../../database/client.js";

const checkpointPath = fileURLToPath(new URL("../../../catalog-youtube.checkpoint.ndjson", import.meta.url));
let processed = 0;
try {
  processed = (await readFile(checkpointPath, "utf8")).split(/\r?\n/).filter(Boolean).length;
} catch {}

const database = createDatabaseClient(1);
try {
  const [stats] = await database<Array<{
    total: number; with_id: number; with_views: number; missing_id: number;
  }>>`
    select count(*)::int as total,
      count(*) filter (where youtube_video_id is not null)::int as with_id,
      count(*) filter (where youtube_views is not null)::int as with_views,
      count(*) filter (where youtube_video_id is null)::int as missing_id
    from public.music_catalog
  `;
  console.info(`[YTMusic][ESTADO] checkpoint=${processed} total=${stats.total} ` +
    `conVideoId=${stats.with_id} conVistas=${stats.with_views} sinVideoId=${stats.missing_id} ` +
    `cobertura=${(stats.with_id / Math.max(1, stats.total) * 100).toFixed(2)}%`);
} finally {
  await database.end();
}
