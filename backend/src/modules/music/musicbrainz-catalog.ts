import { env } from "../../config/env.js";
import type { SongCandidate, SongConstraints } from "./song-ranking.service.js";

interface MbRecording {
  id: string;
  title: string;
  "first-release-date"?: string;
  tags?: Array<{ name: string; count: number }>;
  "artist-credit"?: Array<{
    name: string;
    joinphrase?: string;
    artist?: { id: string; name: string };
  }>;
}
interface MbResponse { recordings?: MbRecording[] }

const PAGE_SIZE = 100;
const MAX_CANDIDATES = 500;
const MAX_INTENT_TAGS = 4;
const GLOBAL_INTERVAL_MS = 1_200;
const MAX_ATTEMPTS = 3;
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
let requestQueue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function enqueueRequest<T>(task: () => Promise<T>) {
  const run = requestQueue.then(async () => {
    const remaining = GLOBAL_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (remaining > 0) await wait(remaining);
    lastRequestAt = Date.now();
    return task();
  });
  requestQueue = run.then(() => undefined, () => undefined);
  return run;
}

export async function fetchMusicBrainzWithRetry(url: URL, label: string, page = 1) {
  let lastResponse: Response | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await enqueueRequest(() => fetch(url, {
        headers: { "User-Agent": env.MUSICBRAINZ_USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      }));
      lastResponse = response;
      if (response.ok || !TRANSIENT_STATUSES.has(response.status)) return response;
      if (attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : 2 ** attempt * 1_000 + Math.floor(Math.random() * 500);
        console.warn(
          `[Música][MusicBrainz] HTTP ${response.status}; reintento ${attempt + 1}/${MAX_ATTEMPTS} ` +
          `en ${delay}ms (${label}, página ${page}).`,
        );
        await wait(delay);
      }
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = 2 ** attempt * 1_000 + Math.floor(Math.random() * 500);
        console.warn(
          `[Música][MusicBrainz] error de red; reintento ${attempt + 1}/${MAX_ATTEMPTS} ` +
          `en ${delay}ms (${label}, página ${page}).`,
        );
        await wait(delay);
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("MusicBrainz no respondió");
}

function quote(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function objectiveClauses(constraints: SongConstraints) {
  const from = constraints.releaseYear || constraints.yearFrom || 1900;
  const to = constraints.releaseYear || constraints.yearTo || new Date().getUTCFullYear();
  const clauses = [`firstreleasedate:[${from}-01-01 TO ${to}-12-31]`];
  if (constraints.requiredArtist) clauses.push(`artist:${quote(constraints.requiredArtist)}`);
  else if (constraints.allowedArtists?.length) {
    clauses.push(
      `(${constraints.allowedArtists.map((artist) => `artist:${quote(artist)}`).join(" OR ")})`,
    );
  }
  return clauses;
}

function buildQueries(constraints: SongConstraints, intentTags: string[]) {
  const base = objectiveClauses(constraints);
  const genres = constraints.allowedGenres?.length
    ? constraints.allowedGenres
    : constraints.requiredGenre ? [constraints.requiredGenre] : [];
  const queries: Array<{ label: string; clauses: string[]; fallbackGenre?: string }> = [];

  for (const genre of genres) {
    queries.push({
      label: `género:${genre}`,
      clauses: [...base, `tag:${quote(genre)}`],
      fallbackGenre: genre,
    });
  }
  for (const tag of intentTags.slice(0, MAX_INTENT_TAGS)) {
    const clauses = [...base, `tag:${quote(tag)}`];
    if (genres.length) {
      clauses.push(`(${genres.map((genre) => `tag:${quote(genre)}`).join(" OR ")})`);
    }
    queries.push({
      label: `intención:${tag}`,
      clauses,
      fallbackGenre: genres.length === 1 ? genres[0] : undefined,
    });
  }
  // La consulta amplia evita que una canción válida desaparezca solo porque
  // MusicBrainz no tiene sus etiquetas comunitarias completas.
  queries.push({ label: "rango objetivo", clauses: base });

  return queries.filter((query, index, all) =>
    all.findIndex((candidate) =>
      candidate.clauses.join(" AND ").toLowerCase() ===
      query.clauses.join(" AND ").toLowerCase()) === index);
}

export async function getMusicBrainzCandidates(
  constraints: SongConstraints,
  excluded: string[],
  intentTags: string[] = [],
  hasEnoughCandidates?: (candidates: SongCandidate[]) => Promise<boolean>,
): Promise<SongCandidate[]> {
  const queries = buildQueries(constraints, intentTags);
  const targetPerQuery = Math.max(PAGE_SIZE, Math.ceil(MAX_CANDIDATES / queries.length));
  // En modo adaptativo no repartimos de antemano las 500 candidatas entre
  // consultas: seguimos paginando la consulta vigente hasta alcanzar las 120
  // objetivamente válidas o agotar resultados/el tope global.
  const pagesPerQuery = hasEnoughCandidates
    ? Math.ceil(MAX_CANDIDATES / PAGE_SIZE)
    : Math.ceil(targetPerQuery / PAGE_SIZE);
  const blocked = new Set(excluded.map((value) => value.toLowerCase()));
  const candidates = new Map<string, SongCandidate>();
  let requestCount = 0;

  for (const query of queries) {
    for (let page = 0; page < pagesPerQuery && candidates.size < MAX_CANDIDATES; page += 1) {
      const url = new URL("https://musicbrainz.org/ws/2/recording");
      url.searchParams.set("query", query.clauses.join(" AND "));
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(page * PAGE_SIZE));
      let response: Response;
      try {
        response = await fetchMusicBrainzWithRetry(url, query.label, page + 1);
      } catch (error) {
        console.warn(
          `[Música][MusicBrainz] ${error instanceof Error ? error.message : String(error)}; ` +
          `se conservan ${candidates.size} candidatas ya recuperadas.`,
        );
        break;
      }
      requestCount += 1;
      if (!response.ok) {
        console.warn(
          `[Música][MusicBrainz] HTTP ${response.status} en consulta=${query.label} ` +
          `página=${page + 1}; se conservan ${candidates.size} candidatas ya recuperadas.`,
        );
        break;
      }
      const payload = await response.json() as MbResponse;
      const recordings = payload.recordings ?? [];

      for (const recording of recordings) {
        if (candidates.size >= MAX_CANDIDATES) break;
        const artist = recording["artist-credit"]
          ?.map((credit) => `${credit.name}${credit.joinphrase ?? ""}`)
          .join("")
          .trim() ?? "";
        const year = Number(recording["first-release-date"]?.slice(0, 4));
        if (!recording.title || !artist || !Number.isFinite(year)) continue;
        if (blocked.has(`${recording.title}|${artist}`.toLowerCase())) continue;
        const tags = [...(recording.tags ?? [])]
          .sort((left, right) => right.count - left.count)
          .map((tag) => tag.name);
        if (candidates.has(recording.id)) continue;
        candidates.set(recording.id, {
          source: "musicbrainz",
          title: recording.title,
          artist,
          recordingMbid: recording.id,
          artistMbid: recording["artist-credit"]?.[0]?.artist?.id,
          releaseYear: year,
          genre: tags[0] ?? query.fallbackGenre ?? "",
          tags,
          semanticDescription: tags.length
            ? `Etiquetas comunitarias: ${tags.slice(0, 12).join(", ")}.`
            : "Sin etiquetas descriptivas disponibles.",
          difficultyScore: 50,
        });
      }
      console.info(
        `[Música][MusicBrainz] consulta=${query.label} página=${page + 1} ` +
        `recibidas=${recordings.length} acumuladas=${candidates.size}.`,
      );
      if (
        hasEnoughCandidates &&
        await hasEnoughCandidates([...candidates.values()])
      ) {
        console.info(
          `[Música][MusicBrainz] objetivo adaptativo alcanzado; ` +
          `${candidates.size} recuperadas en ${requestCount} peticiones.`,
        );
        return [...candidates.values()];
      }
      if (recordings.length < PAGE_SIZE) break;
    }
  }

  console.info(
    `[Música][MusicBrainz] ${candidates.size} candidatas únicas; ` +
    `${requestCount} peticiones; rango completo sin reparto obligatorio por décadas.`,
  );
  return [...candidates.values()].slice(0, MAX_CANDIDATES);
}
