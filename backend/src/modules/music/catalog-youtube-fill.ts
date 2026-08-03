import { appendFile, readFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "../../database/client.js";
import { normalizeCatalogText } from "./catalog-utils.js";

interface CatalogTrack {
  normalized_key: string;
  title: string;
  artist: string;
}

interface SearchResult {
  videoId: string;
  title: string;
  artists: string[];
  durationSeconds?: number | null;
  resultType?: string;
  videoType?: string;
}

interface BridgeResponse {
  requestId: string;
  results?: SearchResult[];
  error?: string;
}

interface SelectedResult extends SearchResult {
  matchScore: number;
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const limit = Math.max(1, Number(args.get("limit") ?? 40_000));
const processLimit = Math.max(1, Number(args.get("process-limit") ?? limit));
const workerCount = Math.min(72, Math.max(1, Number(args.get("workers") ?? 72)));
const delayMin = Math.max(0, Number(args.get("delay-min") ?? 0.1));
const delayMax = Math.max(delayMin, Number(args.get("delay-max") ?? 0.25));
const skipViews = args.has("skip-views");
const ignoreCheckpoint = args.has("ignore-checkpoint");
const searchMode = args.get("search-mode") ?? "songs";
if (!["songs", "videos", "all"].includes(searchMode)) {
  throw new Error(`search-mode inválido: ${searchMode}`);
}
const checkpointPath = fileURLToPath(new URL("../../../catalog-youtube.checkpoint.ndjson", import.meta.url));
const bridgePath = fileURLToPath(new URL("./ytmusic-bridge.py", import.meta.url));
// Las búsquedas pueden tener alta concurrencia sin abrir la misma cantidad de
// conexiones PostgreSQL; postgres.js pone en cola las escrituras breves.
const database = createDatabaseClient(Math.min(10, Math.max(3, workerCount + 1)));

function tokens(value: string) {
  return new Set(normalizeCatalogText(value)
    .replace(/\b(feat|featuring|ft|official|audio|video|lyrics|lyric)\b/g, " ")
    .split(/\s+/).filter(Boolean));
}

function coverage(expected: Set<string>, actual: Set<string>) {
  if (!expected.size) return 0;
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return matches / expected.size;
}

function selectResult(track: CatalogTrack, results: SearchResult[]): SelectedResult | null {
  const expectedTitle = tokens(track.title);
  const expectedArtist = tokens(track.artist);
  const ranked = results.flatMap((result) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(result.videoId)) return [];
    const titleScore = coverage(expectedTitle, tokens(result.title));
    const artistText = result.artists.join(" ");
    const artistScore = coverage(expectedArtist, tokens(artistText));
    const durationOkay = result.durationSeconds == null ||
      (result.durationSeconds >= 60 && result.durationSeconds <= 900);
    if (!durationOkay || titleScore < 0.7 || artistScore < 0.5) return [];
    const matchScore = titleScore * 0.65 + artistScore * 0.35;
    return [{ ...result, matchScore }];
  }).sort((left, right) => right.matchScore - left.matchScore);
  return ranked[0] ?? null;
}

class Bridge {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, {
    resolve: (response: BridgeResponse) => void;
    reject: (error: Error) => void;
  }>();

  constructor() {
    this.child = spawn("python", [bridgePath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        YTMUSIC_DELAY_MIN: String(delayMin),
        YTMUSIC_DELAY_MAX: String(delayMax),
      },
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const response = JSON.parse(line) as BridgeResponse;
        const waiter = this.pending.get(response.requestId);
        if (!waiter) return;
        this.pending.delete(response.requestId);
        waiter.resolve(response);
      } catch (error) {
        console.warn(`[YTMusic] Respuesta inválida: ${line.slice(0, 300)}`);
      }
    });
    this.child.stderr.on("data", (chunk) => console.warn(`[YTMusic bridge] ${String(chunk).trim()}`));
    this.child.on("exit", (code) => {
      for (const waiter of this.pending.values()) waiter.reject(new Error(`Bridge terminó con código ${code}`));
      this.pending.clear();
    });
  }

  lookup(track: CatalogTrack) {
    return new Promise<BridgeResponse>((resolve, reject) => {
      this.pending.set(track.normalized_key, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({
        requestId: track.normalized_key,
        title: track.title,
        artist: track.artist,
        searchFilter: searchMode,
      })}\n`);
    });
  }

  close() {
    this.child.stdin.end();
  }
}

async function loadCheckpoint() {
  try {
    const content = await readFile(checkpointPath, "utf8");
    return new Set(content.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return (JSON.parse(line) as { key: string }).key; } catch { return ""; }
    }).filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

async function fetchYouTubeDetails(ids: string[]) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || ids.length === 0) return new Map<string, number>();
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,status");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`YouTube videos.list HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as {
    items?: Array<{ id: string; status?: { embeddable?: boolean }; statistics?: { viewCount?: string } }>;
  };
  return new Map((payload.items ?? []).filter((item) => item.status?.embeddable !== false).map((item) => [
    item.id,
    Number(item.statistics?.viewCount ?? 0),
  ]));
}

const checkpoint = await loadCheckpoint();
const tracks = await database<CatalogTrack[]>`
  select normalized_key, title, artist
  from public.music_catalog
  where youtube_video_id is null
  order by release_year desc, source_score desc nulls last, normalized_key
  limit ${limit}
`;
const queue = tracks
  .filter((track) => ignoreCheckpoint || !checkpoint.has(track.normalized_key))
  .slice(0, processLimit);
const bridges = Array.from({ length: workerCount }, () => new Bridge());
const startedAt = Date.now();
let cursor = 0;
let processed = 0;
let found = 0;
let rejected = 0;
let errors = 0;
const idsFoundThisRun: string[] = [];
const failedTracks = new Map<string, CatalogTrack>();

console.info(`[YTMusic][INICIO] pendientesBD=${tracks.length} reanudadas=${tracks.length - queue.length} ` +
  `porProcesar=${queue.length} workers=${workerCount} delay=${delayMin}-${delayMax}s ` +
  `modo=${searchMode} ignoreCheckpoint=${ignoreCheckpoint}`);

async function processTrack(track: CatalogTrack, bridge: Bridge, retryAttempt = false) {
  let completed = false;
  try {
    const response = await bridge.lookup(track);
    if (response.error) throw new Error(response.error);
    const selected = selectResult(track, response.results ?? []);
    if (!selected) {
      rejected += 1;
      completed = true;
      return;
    }
    await database`
      update public.music_catalog set
        youtube_video_id = ${selected.videoId},
        youtube_url = ${`https://www.youtube.com/watch?v=${selected.videoId}`},
        video_lookup_status = 'found',
        video_lookup_checked_at = now(),
        updated_at = now()
      where normalized_key = ${track.normalized_key}
        and youtube_video_id is null
    `;
    found += 1;
    completed = true;
    idsFoundThisRun.push(selected.videoId);
    console.info(`[YTMusic][✓] score=${selected.matchScore.toFixed(3)} id=${selected.videoId} ` +
      `views=pendiente-lote | ${track.title} — ${track.artist}`);
  } catch (error) {
    errors += 1;
    failedTracks.set(track.normalized_key, track);
    console.warn(`[YTMusic][ERROR] ${track.title} — ${track.artist} | ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (!retryAttempt) processed += 1;
    if (completed) {
      await appendFile(checkpointPath, `${JSON.stringify({ key: track.normalized_key, at: new Date().toISOString() })}\n`);
    }
    if (!retryAttempt && (processed === 1 || processed % 25 === 0 || processed === queue.length)) {
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1_000);
      const rate = processed / elapsedSeconds;
      const etaMinutes = rate ? (queue.length - processed) / rate / 60 : 0;
      console.info(`[YTMusic][PROGRESO] ${processed}/${queue.length} (${(processed / Math.max(1, queue.length) * 100).toFixed(2)}%) ` +
        `encontradas=${found} sinCoincidencia=${rejected} errores=${errors} velocidad=${(rate * 60).toFixed(1)}/min ` +
        `ETA=${etaMinutes.toFixed(0)}min`);
    }
  }
}

async function runWorker(bridge: Bridge) {
  while (true) {
    const index = cursor++;
    const track = queue[index];
    if (!track) return;
    await processTrack(track, bridge);
  }
}

try {
  await Promise.all(bridges.map(runWorker));
  for (let round = 1; round <= 2 && failedTracks.size; round += 1) {
    const retryBatch = [...failedTracks.values()];
    failedTracks.clear();
    console.info(`[YTMusic][REINTENTOS] ronda=${round}/2 canciones=${retryBatch.length}`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    let retryCursor = 0;
    await Promise.all(bridges.map(async (bridge) => {
      while (true) {
        const track = retryBatch[retryCursor++];
        if (!track) return;
        await processTrack(track, bridge, true);
      }
    }));
  }
  if (failedTracks.size) {
    console.warn(`[YTMusic][REINTENTOS] agotados=${failedTracks.size}; quedarán disponibles para la próxima ejecución.`);
  }
  if (!skipViews && process.env.YOUTUBE_API_KEY && idsFoundThisRun.length) {
    console.info(`[YTMusic][VISTAS] Consultando ${idsFoundThisRun.length} IDs en lotes de 50...`);
    for (let index = 0; index < idsFoundThisRun.length; index += 50) {
      const batch = idsFoundThisRun.slice(index, index + 50);
      try {
        const details = await fetchYouTubeDetails(batch);
        for (const [videoId, views] of details) {
          await database`
            update public.music_catalog set youtube_views = ${views}, youtube_checked_at = now(), updated_at = now()
            where youtube_video_id = ${videoId} and youtube_views is null
          `;
        }
        console.info(`[YTMusic][VISTAS] ${Math.min(index + 50, idsFoundThisRun.length)}/${idsFoundThisRun.length}`);
      } catch (error) {
        console.warn(`[YTMusic][VISTAS][ERROR] lote=${index / 50 + 1} ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }
  console.info(`[YTMusic][FINAL] procesadas=${processed} encontradas=${found} ` +
    `sinCoincidencia=${rejected} errores=${errors}`);
} finally {
  bridges.forEach((bridge) => bridge.close());
  await database.end();
}
