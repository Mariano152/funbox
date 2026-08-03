import { createDatabaseClient } from "../../database/client.js";
import { env } from "../../config/env.js";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const concurrency = Math.min(50, Math.max(1, Number(args.get("workers") ?? 20)));
const limit = Math.max(1, Number(args.get("limit") ?? 100_000));
const database = createDatabaseClient(Math.min(10, concurrency));

if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY no está configurada");
const youtubeApiKey = env.YOUTUBE_API_KEY;

const rows = await database<Array<{ youtube_video_id: string }>>`
  select distinct youtube_video_id
  from public.music_catalog
  where youtube_video_id is not null and youtube_views is null
  order by youtube_video_id
  limit ${limit}
`;
const batches: string[][] = [];
for (let index = 0; index < rows.length; index += 50) {
  batches.push(rows.slice(index, index + 50).map((row) => row.youtube_video_id));
}

let cursor = 0;
let completedBatches = 0;
let updatedVideos = 0;
let unavailableVideos = 0;
let errors = 0;
let stopped = false;
const startedAt = Date.now();

console.info(`[YouTube Views][INICIO] ids=${rows.length} lotes=${batches.length} workers=${concurrency}`);

async function fetchBatch(ids: string[]) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", youtubeApiKey);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 800);
        const error = new Error(`YouTube videos.list HTTP ${response.status}: ${detail}`);
        if (response.status === 403 && /quota/i.test(detail)) {
          stopped = true;
          throw error;
        }
        throw error;
      }
      const payload = await response.json() as {
        items?: Array<{ id?: string; statistics?: { viewCount?: string } }>;
      };
      return new Map((payload.items ?? []).flatMap((item) => {
        const views = Number(item.statistics?.viewCount);
        return item.id && Number.isSafeInteger(views) ? [[item.id, views] as const] : [];
      }));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (stopped || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1_000));
    }
  }
  throw lastError ?? new Error("YouTube videos.list falló");
}

async function processBatch(ids: string[]) {
  try {
    const views = await fetchBatch(ids);
    const foundIds = [...views.keys()];
    const foundViews = [...views.values()];
    if (foundIds.length) {
      await database`
        update public.music_catalog as catalog set
          youtube_views = data.views,
          youtube_checked_at = now(),
          updated_at = now()
        from unnest(${foundIds}::text[], ${foundViews}::bigint[]) as data(video_id, views)
        where catalog.youtube_video_id = data.video_id
          and catalog.youtube_views is null
      `;
    }
    updatedVideos += foundIds.length;
    unavailableVideos += ids.length - foundIds.length;
  } catch (error) {
    errors += 1;
    console.warn(`[YouTube Views][ERROR] lote=${completedBatches + 1} ids=${ids.length} ` +
      `${error instanceof Error ? error.message : String(error)}`);
  } finally {
    completedBatches += 1;
    if (completedBatches === 1 || completedBatches % 10 === 0 || completedBatches === batches.length) {
      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1_000);
      const rate = updatedVideos / elapsedSeconds * 60;
      const remaining = rows.length - Math.min(rows.length, completedBatches * 50);
      const etaMinutes = rate ? remaining / rate : 0;
      console.info(`[YouTube Views][PROGRESO] lotes=${completedBatches}/${batches.length} ` +
        `actualizados=${updatedVideos}/${rows.length} noDisponibles=${unavailableVideos} errores=${errors} ` +
        `velocidad=${rate.toFixed(0)} ids/min ETA=${etaMinutes.toFixed(1)}min`);
    }
  }
}

async function worker() {
  while (!stopped) {
    const batch = batches[cursor++];
    if (!batch) return;
    await processBatch(batch);
  }
}

try {
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.info(`[YouTube Views][FINAL] actualizados=${updatedVideos} noDisponibles=${unavailableVideos} ` +
    `errores=${errors} detenidoPorQuota=${stopped}`);
} finally {
  await database.end();
}
