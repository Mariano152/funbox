import { createDatabaseClient } from "../../database/client.js";
import { env } from "../../config/env.js";

type CatalogLanguage = "es" | "en" | "international";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const workers = Math.min(72, Math.max(1, Number(args.get("workers") ?? 12)));
const limit = Math.max(1, Number(args.get("limit") ?? 100_000));
const retry = args.get("retry") === "true";
const database = createDatabaseClient(Math.min(10, workers));

if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY no está configurada");

function mapLanguage(value?: string): CatalogLanguage | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  // El juego agrupa cualquier idioma distinto de español o inglés como
  // internacional. "zxx" (sin contenido lingüístico) también entra aquí.
  return "international";
}

const rows = await database<Array<{ youtube_video_id: string }>>`
  select distinct youtube_video_id
  from public.music_catalog
  where youtube_video_id is not null
    and language is null
    and (${retry} or not ('youtube-audio-language-checked' = any(source_names)))
  order by youtube_video_id
  limit ${limit}
`;
const batches = Array.from({ length: Math.ceil(rows.length / 50) }, (_, index) =>
  rows.slice(index * 50, index * 50 + 50).map((row) => row.youtube_video_id));

let cursor = 0;
let completed = 0;
let labelled = 0;
let missing = 0;
let errors = 0;
let quotaExhausted = false;
const startedAt = Date.now();

console.info(`[Idiomas YouTube][INICIO] ids=${rows.length} lotes=${batches.length} workers=${workers}`);

async function fetchBatch(ids: string[]) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", env.YOUTUBE_API_KEY!);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    if (response.status === 403 && /quota/i.test(detail)) quotaExhausted = true;
    throw new Error(`YouTube videos.list HTTP ${response.status}: ${detail}`);
  }
  const payload = await response.json() as {
    items?: Array<{ id?: string; snippet?: { defaultAudioLanguage?: string } }>;
  };
  return new Map((payload.items ?? []).flatMap((video) => {
    const language = mapLanguage(video.snippet?.defaultAudioLanguage);
    return video.id ? [[video.id, language] as const] : [];
  }));
}

async function processBatch(ids: string[]) {
  try {
    const languages = await fetchBatch(ids);
    const labelledIds = [...languages].flatMap(([id, language]) => language ? [id] : []);
    const labelledLanguages = [...languages].flatMap(([, language]) => language ? [language] : []);
    if (labelledIds.length) {
      await database`
        update public.music_catalog as catalog set
          language = data.language,
          source_names = array_append(array_remove(catalog.source_names, 'youtube-audio-language-checked'), 'youtube-audio-language'),
          updated_at = now()
        from unnest(${labelledIds}::text[], ${labelledLanguages}::text[]) as data(video_id, language)
        where catalog.youtube_video_id = data.video_id and catalog.language is null
      `;
    }
    const checkedIds = [...new Set(ids)];
    if (checkedIds.length) {
      await database`
        update public.music_catalog set
          source_names = case
            when 'youtube-audio-language-checked' = any(source_names) then source_names
            else array_append(source_names, 'youtube-audio-language-checked')
          end,
          updated_at = now()
        where youtube_video_id = any(${checkedIds}::text[]) and language is null
      `;
    }
    labelled += labelledIds.length;
    missing += ids.length - labelledIds.length;
  } catch (error) {
    errors += 1;
    console.warn(`[Idiomas YouTube][ERROR] lote=${completed + 1}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    completed += 1;
    if (completed === 1 || completed % 10 === 0 || completed === batches.length) {
      const elapsedMinutes = Math.max(0.001, (Date.now() - startedAt) / 60_000);
      console.info(`[Idiomas YouTube][PROGRESO] lotes=${completed}/${batches.length} ` +
        `etiquetadas=${labelled} sinDato=${missing} errores=${errors} ` +
        `velocidad=${Math.round((completed * 50) / elapsedMinutes)} ids/min`);
    }
  }
}

async function worker() {
  while (!quotaExhausted) {
    const batch = batches[cursor++];
    if (!batch) return;
    await processBatch(batch);
  }
}

try {
  await Promise.all(Array.from({ length: workers }, worker));
  console.info(`[Idiomas YouTube][FINAL] etiquetadas=${labelled} sinDato=${missing} errores=${errors} quotaAgotada=${quotaExhausted}`);
} finally {
  await database.end();
}
