import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "../../database/client.js";
import { env } from "../../config/env.js";
import { catalogKey, normalizeCatalogText } from "./catalog-utils.js";
import { fetchMusicBrainzWithRetry } from "./musicbrainz-catalog.js";
import { calculateKnownness } from "./knownness.js";
import { searchItunes } from "./itunes-client.js";

interface Candidate {
  normalized_key: string;
  title: string;
  artist: string;
  release_year: number | null;
  primary_genre: string | null;
  musicbrainz_recording_id: string | null;
  musicbrainz_artist_id: string | null;
  listenbrainz_users: number | null;
  listenbrainz_listens: number | null;
  youtube_video_id: string | null;
}
interface SearchResult { videoId: string; title: string; artists: string[]; durationSeconds?: number | null }
interface BridgeResponse { requestId: string; results?: SearchResult[]; error?: string }
interface Recording {
  id?: string; title?: string; score?: number; "first-release-date"?: string;
  releases?: Array<{ date?: string }>;
  genres?: Array<{ name?: string; count?: number }>;
  "artist-credit"?: Array<{ name?: string; joinphrase?: string; artist?: { id?: string } }>;
}
interface ListenBrainzTopRecording {
  recording_mbid?: string; track_name?: string; artist_name?: string;
  artist_mbids?: string[]; listen_count?: number;
}

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const fromYear = Number(args.get("from") ?? 1980);
const toYear = Number(args.get("to") ?? 2026);
const target = Number(args.get("target") ?? 2_500);
const pageLimit = Math.max(1, Number(args.get("pages-per-genre") ?? 100));
const batchSize = Math.max(72, Number(args.get("candidate-batch") ?? 720));
const startCycle = Math.max(0, Number(args.get("start-cycle") ?? 0));
const WORKERS = 72;
const LISTENBRAINZ_WORKERS = Math.max(1, Number(args.get("listenbrainz-workers") ?? 4));
const LISTENBRAINZ_ATTEMPTS = 4;
const GENRES = ["pop", "rock", "hip hop", "electronic", "r&b", "latin", "country", "reggae", "metal", "soul"];
const LISTENBRAINZ_RANGES = ["all_time", "year", "month", "week"];
const CHART_COUNTRIES = [
  "MX", "US", "ES", "GB", "BR", "ZZ",
  "DE", "FR", "IT", "CA", "AU", "AR", "CO", "CL", "PE", "NL", "SE", "PL", "PT", "ZA",
  "PH", "ID", "IN", "JP", "KR",
];
const KWORB_PATHS = [
  ...Array.from({ length: 14 }, (_, index) => `topvideos_published_${2023 - index}.html`),
  "topvideos_published_earlier.html",
  "topvideos_100m.html", "topvideos.html",
  "topvideos_hispanophone.html", "topvideos_mexican.html", "topvideos_brazilian.html",
  "topvideos_anglophone.html", "topvideos_arabic.html", "topvideos_francophone.html",
  "topvideos_indian.html", "topvideos_indonesian.html", "topvideos_japanese.html",
  "topvideos_korean.html", "topvideos_thai.html", "topvideos_turkish.html",
  "topvideos_vietnamese.html", "topvideos_slavic.html", "topvideos_german.html",
  "topvideos_italian.html", "topvideos_nordic.html", "topvideos_dutch.html",
];
const KWORB_REQUEST_DELAY_MS = Math.max(500, Number(args.get("kworb-delay-ms") ?? 1_000));
if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY no está configurada");
if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear || !Number.isInteger(startCycle)) {
  throw new Error("Rango de años inválido");
}
const database = createDatabaseClient(10);
const bridgePath = fileURLToPath(new URL("./ytmusic-bridge.py", import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// iTunes bloquea las ráfagas de enriquecimiento masivo con 403/429. Se puede
// reactivar explícitamente para pruebas pequeñas con --itunes=true.
let itunesDisabledUntil = args.get("itunes") === "true" ? 0 : Number.POSITIVE_INFINITY;

async function runConcurrent<T>(items: T[], workers: number, task: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await task(items[index]!, index);
    }
  }));
}

function tokens(value: string) {
  return new Set(normalizeCatalogText(value)
    .replace(/\b(feat|featuring|ft|official|audio|video|lyrics|lyric)\b/g, " ")
    .split(/\s+/).filter(Boolean));
}
function coverage(expected: Set<string>, actual: Set<string>) {
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return expected.size ? matches / expected.size : 0;
}
function selectResult(candidate: Candidate, results: SearchResult[]) {
  const title = tokens(candidate.title);
  const artist = tokens(candidate.artist);
  return results.flatMap((result) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(result.videoId)) return [];
    const titleScore = coverage(title, tokens(result.title));
    const artistScore = coverage(artist, tokens(result.artists.join(" ")));
    if (titleScore < 0.7 || artistScore < 0.5) return [];
    if (result.durationSeconds != null && (result.durationSeconds < 60 || result.durationSeconds > 900)) return [];
    return [{ ...result, score: titleScore * 0.65 + artistScore * 0.35 }];
  }).sort((left, right) => right.score - left.score)[0];
}

class Bridge {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (value: BridgeResponse) => void; reject: (error: Error) => void }>();
  constructor() {
    this.child = spawn("python", [bridgePath], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const response = JSON.parse(line) as BridgeResponse;
        const waiter = this.pending.get(response.requestId);
        if (!waiter) return;
        this.pending.delete(response.requestId);
        waiter.resolve(response);
      } catch {}
    });
    this.child.on("exit", (code) => {
      for (const waiter of this.pending.values()) waiter.reject(new Error(`Bridge terminó: ${code}`));
      this.pending.clear();
    });
  }
  lookup(candidate: Candidate) {
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(candidate.normalized_key);
        reject(new Error("timeout buscando ID de YouTube Music"));
      }, 45_000);
      this.pending.set(candidate.normalized_key, {
        resolve: (response) => { clearTimeout(timeout); resolve(response); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify({
        requestId: candidate.normalized_key, title: candidate.title,
        artist: candidate.artist, searchFilter: "songs",
      })}\n`);
    });
  }
  chartTracks(country: string) {
    const requestId = `charts-${country}-${Date.now()}`;
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("timeout obteniendo YouTube Music Charts"));
      }, 60_000);
      this.pending.set(requestId, {
        resolve: (response) => { clearTimeout(timeout); resolve(response); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify({ requestId, action: "chart_tracks", country })}\n`);
    });
  }
  close() { this.child.stdin.end(); }
}

async function discover(genre: string, page: number) {
  let added = 0;
  const url = new URL("https://musicbrainz.org/ws/2/recording");
  url.searchParams.set("query", `firstreleasedate:[${fromYear}-01-01 TO ${toYear}-12-31] AND tag:\"${genre}\"`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", String(page * 100));
  const response = await fetchMusicBrainzWithRetry(url, `éxitos ${fromYear}-${toYear}/${genre}`, page + 1);
  if (!response.ok) return 0;
  const recordings = ((await response.json()) as { recordings?: Recording[] }).recordings ?? [];
  for (const recording of recordings) {
    const title = recording.title?.trim();
    const artist = recording["artist-credit"]?.map((credit) =>
      `${credit.name ?? ""}${credit.joinphrase ?? ""}`).join("").trim();
    const releaseYear = Number(recording["first-release-date"]?.slice(0, 4));
    if (!recording.id || !title || !artist || releaseYear < fromYear || releaseYear > toYear) continue;
    const key = catalogKey(title, artist);
    const result = await database`
      insert into public.music_success_candidates (
        normalized_key, title, artist, release_year, primary_genre,
        musicbrainz_recording_id, musicbrainz_artist_id, source_score
      ) values (${key}, ${title}, ${artist}, ${releaseYear}, ${genre}, ${recording.id},
        ${recording["artist-credit"]?.[0]?.artist?.id ?? null}, ${recording.score ?? null})
      on conflict (normalized_key) do nothing returning normalized_key
    `;
    if (result.count) added += 1;
  }
  return added;
}

async function discoverListenBrainzTop(range: string, offset: number) {
  const url = new URL("https://api.listenbrainz.org/1/stats/sitewide/recordings");
  url.searchParams.set("range", range);
  url.searchParams.set("count", "100");
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ListenBrainz top recordings HTTP ${response.status}`);
  const payload = await response.json() as { payload?: { recordings?: ListenBrainzTopRecording[] } };
  const recordings = payload.payload?.recordings ?? [];
  let added = 0;
  for (const top of recordings) {
    const mbid = top.recording_mbid;
    const title = top.track_name?.trim();
    const artist = top.artist_name?.trim();
    if (!mbid || !title || !artist) continue;
    try {
      const key = catalogKey(title, artist);
      const result = await database`
        insert into public.music_success_candidates (
          normalized_key, title, artist, release_year, primary_genre,
          musicbrainz_recording_id, musicbrainz_artist_id, source_score,
          listenbrainz_listens, status
        ) values (${key}, ${title}, ${artist}, ${null}, ${null}, ${mbid},
          ${top.artist_mbids?.[0] ?? null},
          ${top.listen_count ?? null}, ${top.listen_count ?? null}, 'prioritized')
        on conflict (normalized_key) do nothing returning normalized_key
      `;
      if (result.count) added += 1;
    } catch (error) {
      console.warn(`[Éxitos][TOP] ${title} — ${artist}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.info(`[Éxitos][TOP] rango=${range} offset=${offset} recibidas=${recordings.length} nuevas=${added}`);
  return added;
}

async function discoverYouTubeMusicCharts(country: string) {
  const bridge = new Bridge();
  try {
    const response = await bridge.chartTracks(country);
    let added = 0;
    for (const track of response.results ?? []) {
      const title = track.title?.trim();
      const artist = track.artists?.join(", ").trim();
      if (!title || !artist || !/^[A-Za-z0-9_-]{11}$/.test(track.videoId)) continue;
      const key = catalogKey(title, artist);
      const result = await database`
        insert into public.music_success_candidates (
          normalized_key, title, artist, release_year, youtube_video_id,
          source_score, listenbrainz_listens, status
        ) values (${key}, ${title}, ${artist}, ${null}, ${track.videoId},
          ${2_000_000_000}, ${2_000_000_000}, 'id_found')
        on conflict (normalized_key) do nothing returning normalized_key
      `;
      added += result.count;
    }
    console.info(`[Éxitos][YTM-CHARTS] país=${country} recibidas=${response.results?.length ?? 0} nuevas=${added}`);
    return added;
  } finally {
    bridge.close();
  }
}

async function discoverAppleCharts(country: string) {
  const response = await fetch(
    `https://rss.marketingtools.apple.com/api/v2/${country.toLowerCase()}/music/most-played/100/songs.json`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new Error(`Apple Music charts HTTP ${response.status}`);
  const payload = await response.json() as { feed?: { results?: Array<{
    name?: string; artistName?: string; releaseDate?: string; genres?: Array<{ name?: string }>;
  }> } };
  let added = 0;
  for (const [rank, song] of (payload.feed?.results ?? []).entries()) {
    const title = song.name?.trim();
    const artist = song.artistName?.trim();
    const year = Number(song.releaseDate?.slice(0, 4));
    if (!title || !artist || !Number.isInteger(year) || year < fromYear || year > toYear) continue;
    const genre = song.genres?.find((item) => item.name && !/^(music|música)$/i.test(item.name))?.name ?? null;
    const key = catalogKey(title, artist);
    const result = await database`
      insert into public.music_success_candidates (
        normalized_key, title, artist, release_year, primary_genre,
        source_score, listenbrainz_listens, status
      ) values (${key}, ${title}, ${artist}, ${year}, ${genre},
        ${1_900_000_000 - rank}, ${1_900_000_000 - rank}, 'prioritized')
      on conflict (normalized_key) do nothing returning normalized_key
    `;
    added += result.count;
  }
  console.info(`[Éxitos][APPLE-CHARTS] país=${country} nuevas=${added}`);
  return added;
}

function plainHtml(value: string) {
  return value.replace(/<sup[\s\S]*?<\/sup>/gi, " ").replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&quot;", '"')
    .replaceAll("&ndash;", "-").replaceAll("&mdash;", "-").replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ").trim();
}

function parseKworbVideoLabel(label: string) {
  const cleaned = plainHtml(label).replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/\s+(?:-|–|—|\|)\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const artist = parts.shift()!;
  const title = parts.join(" - ")
    .replace(/\s*[\[(](?:official|lyrics?|audio|music video|visuali[sz]er|hd|4k)[^\])]*[\])]/gi, " ")
    .replace(/\s+/g, " ").trim();
  if (!title || artist.length < 2 || artist.length > 180 || title.length > 300) return null;
  return { title, artist };
}

async function discoverKworb(path: string) {
  const response = await fetch(`https://kworb.net/youtube/${path}`, {
    headers: { "User-Agent": "FunboxMusicCatalog/1.0 (low-frequency public chart reader)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Kworb ${path} HTTP ${response.status}`);
  const html = await response.text();
  const publishedYearMatch = path.match(/^topvideos_published_(\d{4})\.html$/);
  const publishedYear = publishedYearMatch ? Number(publishedYearMatch[1]) : null;
  let received = 0;
  let added = 0;
  const rowPattern = /<tr[^>]*>[\s\S]*?<a[^>]+href=["'](?:\.\/)?video\/([A-Za-z0-9_-]{11})\.html["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*>\s*([\d,]+)\s*<\/td>[\s\S]*?<\/tr>/gi;
  const matches = [...html.matchAll(rowPattern)];
  const videoIds = [...new Set(matches.map((match) => match[1]!).filter(Boolean))];
  const knownRows = videoIds.length ? await database<Array<{ youtube_video_id: string }>>`
    select youtube_video_id from public.music_success_candidates
    where youtube_video_id = any(${videoIds}::text[])
    union
    select youtube_video_id from public.music_catalog
    where youtube_video_id = any(${videoIds}::text[])
  ` : [];
  const knownVideoIds = new Set(knownRows.map((row) => row.youtube_video_id));
  for (const match of matches) {
    received += 1;
    const videoId = match[1]!;
    if (knownVideoIds.has(videoId)) continue;
    const parsed = parseKworbVideoLabel(match[2] ?? "");
    const views = Number((match[3] ?? "0").replaceAll(",", ""));
    if (!parsed || !Number.isFinite(views) || views <= 50_000_000) continue;
    if (publishedYear != null && (publishedYear < fromYear || publishedYear > toYear)) continue;
    const key = catalogKey(parsed.title, parsed.artist);
    const result = await database`
      insert into public.music_success_candidates (
        normalized_key, title, artist, release_year, youtube_video_id,
        youtube_views, source_score, listenbrainz_listens, status
      ) values (${key}, ${parsed.title}, ${parsed.artist}, ${publishedYear}, ${videoId},
        ${views}, ${views}, ${views}, 'id_found')
      on conflict (normalized_key) do update set
        youtube_video_id = coalesce(music_success_candidates.youtube_video_id, excluded.youtube_video_id),
        youtube_views = greatest(music_success_candidates.youtube_views, excluded.youtube_views),
        source_score = greatest(music_success_candidates.source_score, excluded.source_score),
        status = case when music_success_candidates.status in ('discovered', 'prioritized', 'error')
          then 'id_found' else music_success_candidates.status end,
        updated_at = now()
      returning (xmax = 0) as inserted
    `;
    if (result[0]?.inserted) {
      added += 1;
      knownVideoIds.add(videoId);
    }
  }
  console.info(`[Éxitos][KWORB] página=${path} recibidas=${received} nuevas=${added}`);
  await sleep(KWORB_REQUEST_DELAY_MS);
  return added;
}

async function discoverBillboardYear(year: number) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", `Billboard Year-End Hot 100 singles of ${year}`);
  url.searchParams.set("prop", "text");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Wikipedia Billboard ${year} HTTP ${response.status}`);
  const payload = await response.json() as { parse?: { text?: { "*"?: string } } };
  const html = payload.parse?.text?.["*"] ?? "";
  let added = 0;
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => plainHtml(match[1] ?? ""));
    if (cells.length < 3 || !/^\d+$/.test(cells[0] ?? "")) continue;
    const title = cells[1]?.replace(/^"|"$/g, "").trim();
    const artist = cells[2]?.trim();
    if (!title || !artist) continue;
    const key = catalogKey(title, artist);
    const rank = Number(cells[0]);
    const result = await database`
      insert into public.music_success_candidates (
        normalized_key, title, artist, release_year, source_score,
        listenbrainz_listens, status
      ) values (${key}, ${title}, ${artist}, ${year}, ${1_800_000_000 - rank},
        ${1_800_000_000 - rank}, 'prioritized')
      on conflict (normalized_key) do nothing returning normalized_key
    `;
    added += result.count;
  }
  console.info(`[Éxitos][BILLBOARD] año=${year} nuevas=${added}`);
  return added;
}

async function enrichSuccessfulCandidate(candidate: Candidate) {
  if (Date.now() >= itunesDisabledUntil) try {
    const results = await searchItunes(`${candidate.title} ${candidate.artist}`, { limit: 10 });
    const match = results.flatMap((result) => {
      const year = Number(result.releaseDate?.slice(0, 4));
      const titleScore = coverage(tokens(candidate.title), tokens(result.trackName ?? ""));
      const artistScore = coverage(tokens(candidate.artist), tokens(result.artistName ?? ""));
        if (result.kind !== "song" || !Number.isInteger(year) || year < fromYear || year > toYear || titleScore < 0.7 || artistScore < 0.5) return [];
      return [{ year, genre: result.primaryGenreName ?? null, score: titleScore * 0.65 + artistScore * 0.35 }];
    }).sort((left, right) => right.score - left.score)[0];
    if (match) {
      candidate.release_year = match.year;
      candidate.primary_genre = match.genre;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP (403|429)/.test(message)) {
      itunesDisabledUntil = Date.now() + 30 * 60_000;
      console.warn("[Éxitos][iTunes] circuito abierto 30min; se usa MusicBrainz.");
    }
    console.warn(`[Éxitos][iTunes] ${candidate.title} — ${candidate.artist}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (candidate.release_year == null && candidate.musicbrainz_recording_id) {
    const metadataUrl = new URL(`https://musicbrainz.org/ws/2/recording/${candidate.musicbrainz_recording_id}`);
    metadataUrl.searchParams.set("fmt", "json");
    metadataUrl.searchParams.set("inc", "releases+genres");
    const response = await fetchMusicBrainzWithRetry(metadataUrl, "metadatos de canción exitosa", 1);
    if (response.ok) {
      const metadata = await response.json() as Recording;
      const years = (metadata.releases ?? []).map((release) => Number(release.date?.slice(0, 4)))
        .filter((year) => Number.isInteger(year) && year >= fromYear && year <= toYear);
      candidate.release_year = years.length ? Math.min(...years) : null;
      candidate.primary_genre ??= [...(metadata.genres ?? [])].sort((left, right) =>
        (right.count ?? 0) - (left.count ?? 0))[0]?.name ?? null;
    }
  }
  if (candidate.release_year == null) {
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
    url.searchParams.set("query", `recording:${quote(candidate.title)} AND artist:${quote(candidate.artist)}`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "5");
    const response = await fetchMusicBrainzWithRetry(url, "búsqueda de metadatos para éxito", 1);
    if (response.ok) {
      const recordings = ((await response.json()) as { recordings?: Recording[] }).recordings ?? [];
      const match = recordings.flatMap((recording) => {
        const year = Number(recording["first-release-date"]?.slice(0, 4));
        const artist = recording["artist-credit"]?.map((credit) =>
          `${credit.name ?? ""}${credit.joinphrase ?? ""}`).join("") ?? "";
        const titleScore = coverage(tokens(candidate.title), tokens(recording.title ?? ""));
        const artistScore = coverage(tokens(candidate.artist), tokens(artist));
        if (!recording.id || !Number.isInteger(year) || year < fromYear || year > toYear || titleScore < 0.7 || artistScore < 0.5) return [];
        return [{ recording, year, score: titleScore * 0.65 + artistScore * 0.35 }];
      }).sort((left, right) => right.score - left.score)[0];
      if (match) {
        candidate.release_year = match.year;
        candidate.musicbrainz_recording_id = match.recording.id ?? null;
        candidate.musicbrainz_artist_id ??= match.recording["artist-credit"]?.[0]?.artist?.id ?? null;
      }
    }
  }
  if (!Number.isInteger(candidate.release_year) || candidate.release_year! < fromYear || candidate.release_year! > toYear) {
    candidate.release_year = null;
    return false;
  }
  await database`
    update public.music_success_candidates set release_year=${candidate.release_year},
      primary_genre=${candidate.primary_genre}, updated_at=now()
    where normalized_key=${candidate.normalized_key}
  `;
  return true;
}

async function prioritize(candidates: Candidate[]) {
  const batches = Array.from({ length: Math.ceil(candidates.length / 10) }, (_, index) =>
    candidates.slice(index * 10, index * 10 + 10).filter((item) => item.musicbrainz_recording_id));
  const populatedBatches = batches.filter((batch) => batch.length > 0);
  await runConcurrent(populatedBatches, LISTENBRAINZ_WORKERS, async (batch) => {
    for (let attempt = 1; attempt <= LISTENBRAINZ_ATTEMPTS; attempt += 1) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (process.env.LISTENBRAINZ_TOKEN) headers.Authorization = `Token ${process.env.LISTENBRAINZ_TOKEN}`;
        const response = await fetch("https://api.listenbrainz.org/1/popularity/recording", {
          method: "POST", headers,
          body: JSON.stringify({ recording_mbids: batch.map((item) => item.musicbrainz_recording_id) }),
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === LISTENBRAINZ_ATTEMPTS) return;
          const retryAfter = Number(response.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000 : 750 * 2 ** (attempt - 1) + Math.random() * 300);
          continue;
        }
        if (!response.ok) return;
        const rows = await response.json() as Array<{
          recording_mbid?: string; total_user_count?: number | null; total_listen_count?: number | null;
        }>;
        const byMbid = new Map(batch.map((candidate) => [candidate.musicbrainz_recording_id, candidate]));
        await Promise.all(rows.map(async (row) => {
          const candidate = byMbid.get(row.recording_mbid ?? null);
          if (candidate) {
            candidate.listenbrainz_users = row.total_user_count ?? null;
            candidate.listenbrainz_listens = row.total_listen_count ?? null;
          }
          await database`
            update public.music_success_candidates set
              listenbrainz_users = ${row.total_user_count ?? null},
              listenbrainz_listens = ${row.total_listen_count ?? null},
              status = 'prioritized', updated_at = now()
            where musicbrainz_recording_id = ${row.recording_mbid ?? null}::uuid
          `;
        }));
        return;
      } catch {
        if (attempt === LISTENBRAINZ_ATTEMPTS) return;
        await sleep(750 * 2 ** (attempt - 1) + Math.random() * 300);
      }
    }
  });
  candidates.sort((left, right) =>
    (right.listenbrainz_users ?? -1) - (left.listenbrainz_users ?? -1) ||
    (right.listenbrainz_listens ?? -1) - (left.listenbrainz_listens ?? -1));
  console.info(`[Éxitos][LISTENBRAINZ] lotes=${populatedBatches.length} trabajadores=${LISTENBRAINZ_WORKERS}`);
}

async function videoDetails(ids: string[]) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics,status");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", env.YOUTUBE_API_KEY!);
  const response = await fetch(url);
  const detail = !response.ok ? await response.text() : "";
  if (!response.ok) throw new Error(`YouTube videos.list ${response.status}: ${detail.slice(0, 300)}`);
  const payload = await response.json() as {
    items?: Array<{ id: string; statistics?: { viewCount?: string }; status?: { embeddable?: boolean } }>;
  };
  return new Map((payload.items ?? []).map((item) => [item.id, {
    views: Number(item.statistics?.viewCount ?? 0), embeddable: item.status?.embeddable !== false,
  }]));
}

async function processCandidates(candidates: Candidate[]) {
  const searchCandidates = candidates.filter((candidate) => !candidate.youtube_video_id);
  const bridges = Array.from({ length: Math.min(WORKERS, searchCandidates.length) }, () => new Bridge());
  let cursor = 0;
  const found = new Map<string, { candidate: Candidate; videoId: string }>();
  for (const candidate of candidates) {
    if (candidate.youtube_video_id && /^[A-Za-z0-9_-]{11}$/.test(candidate.youtube_video_id)) {
      found.set(candidate.normalized_key, { candidate, videoId: candidate.youtube_video_id });
    }
  }
  try {
    await Promise.all(bridges.map(async (bridge) => {
      while (true) {
        const candidate = searchCandidates[cursor++];
        if (!candidate) return;
        try {
          const response = await bridge.lookup(candidate);
          const selected = selectResult(candidate, response.results ?? []);
          if (!selected) throw new Error(response.error ?? "sin coincidencia de YouTube Music");
          found.set(candidate.normalized_key, { candidate, videoId: selected.videoId });
          await database`
            update public.music_success_candidates set youtube_video_id=${selected.videoId},
              status='id_found', attempts=attempts+1, updated_at=now()
            where normalized_key=${candidate.normalized_key}
          `;
        } catch (error) {
          await database`
            update public.music_success_candidates set status='error', attempts=attempts+1,
              last_error=${error instanceof Error ? error.message : String(error)}, checked_at=now(), updated_at=now()
            where normalized_key=${candidate.normalized_key}
          `;
        }
      }
    }));
    const rows = [...new Map([...found.values()].map((row) => [row.videoId, row])).values()];
    let accepted = 0;
    for (let index = 0; index < rows.length; index += 50) {
      const batch = rows.slice(index, index + 50);
      const details = await videoDetails(batch.map((row) => row.videoId));
      await Promise.all(batch.map(async (row) => {
        const video = details.get(row.videoId);
        const success = Boolean(video?.embeddable && video.views > 50_000_000);
        await database`
          update public.music_success_candidates set youtube_views=${video?.views ?? null},
            status=${success ? "accepted" : "rejected"}, checked_at=now(), updated_at=now()
          where normalized_key=${row.candidate.normalized_key}
        `;
        if (!success || !video) return;
        let enriched = false;
        try {
          enriched = await enrichSuccessfulCandidate(row.candidate);
        } catch (error) {
          console.warn(`[Éxitos][METADATOS] ${row.candidate.title}: ` +
            `${error instanceof Error ? error.message : String(error)}`);
        }
        if (!enriched) {
          await database`update public.music_success_candidates set status='error',
            attempts=attempts+1,
            last_error='No se pudo resolver año 1980-2026 después de validar vistas', updated_at=now()
            where normalized_key=${row.candidate.normalized_key}`;
          return;
        }
        const knownness = calculateKnownness({ youtubeViews: video.views });
        const inserted = await database`
          insert into public.music_catalog (
            normalized_key, title, artist, release_year, primary_genre, genres,
            musicbrainz_recording_id, musicbrainz_artist_id, youtube_video_id,
            youtube_views, youtube_checked_at, video_lookup_status, video_lookup_checked_at,
            knownness_score, knownness_confidence, total_plays, catalog_status,
            listenbrainz_users, listenbrainz_listens, source_names, source_score
          ) select ${row.candidate.normalized_key}, ${row.candidate.title}, ${row.candidate.artist},
            ${row.candidate.release_year}, ${row.candidate.primary_genre}, ${[row.candidate.primary_genre].filter(Boolean)},
            ${row.candidate.musicbrainz_recording_id}, ${row.candidate.musicbrainz_artist_id}, ${row.videoId},
            ${video.views}, now(), 'found', now(), ${knownness.score}, ${knownness.confidence},
            ${video.views}, 'ready', ${row.candidate.listenbrainz_users}, ${row.candidate.listenbrainz_listens},
            ${["musicbrainz", "youtube"]}, 100
          where not exists (
            select 1 from public.music_catalog existing
            where existing.youtube_video_id = ${row.videoId}
          )
          on conflict (normalized_key) do nothing
          returning id
        `;
        accepted += inserted.count;
      }));
      const [{ count }] = await database<Array<{ count: number }>>`
        select count(distinct youtube_video_id)::int as count from public.music_catalog
        where release_year between ${fromYear} and ${toYear} and youtube_views > 50000000
      `;
      console.info(`[Éxitos][PROGRESO] global=${count}/${target} ` +
        `revisadas=${Math.min(index + 50, rows.length)}/${rows.length} agregadasLote=${accepted}`);
      if (count >= target) break;
    }
    return accepted;
  } finally {
    bridges.forEach((bridge) => bridge.close());
  }
}

await database`
  update public.music_success_fill_jobs set status='failed', completed_at=now(), heartbeat_at=now(),
    last_error='Reemplazado por una ejecución optimizada'
  where status='running'
`;
const [job] = await database<Array<{ id: string }>>`
  insert into public.music_success_fill_jobs (from_year, to_year, target_per_year)
  values (${fromYear}, ${toYear}, ${target}) returning id
`;
try {
  console.info(`[Éxitos][CONFIG] rangoGlobal=${fromYear}-${toYear} meta=${target} ` +
    `Kworb=${KWORB_PATHS.length} páginas/pausa=${KWORB_REQUEST_DELAY_MS}ms MusicBrainz=1 req/1.2s ` +
    `ListenBrainz=${LISTENBRAINZ_WORKERS} YouTubeID=${WORKERS} loteCandidatas=${batchSize}`);
  const discoveryTasks = GENRES.flatMap((genre) =>
    Array.from({ length: pageLimit }, (_, page) => ({ genre, page })));
  const popularTasks = LISTENBRAINZ_RANGES.flatMap((range) =>
    Array.from({ length: 10 }, (_, page) => ({ range, offset: page * 100 })));
  const historicalYears = Array.from({ length: Math.max(0, Math.min(toYear, 2025) - fromYear + 1) },
    (_, index) => Math.min(toYear, 2025) - index);
  let cycle = startCycle;
  while (true) {
      const [{ count }] = await database<Array<{ count: number }>>`
        select count(distinct youtube_video_id)::int as count from public.music_catalog
        where release_year between ${fromYear} and ${toYear} and youtube_views > 50000000
      `;
      if (count >= target) break;
      if (cycle % discoveryTasks.length === 0) {
        discoveryTasks.sort(() => Math.random() - 0.5);
      }
      const kworbPath = KWORB_PATHS[cycle];
      const sourceCycle = cycle - KWORB_PATHS.length;
      const chartCountry = CHART_COUNTRIES[sourceCycle];
      const appleCountry = CHART_COUNTRIES[sourceCycle - CHART_COUNTRIES.length];
      const historicalYear = historicalYears[sourceCycle - CHART_COUNTRIES.length * 2];
      const popularTask = popularTasks[sourceCycle - CHART_COUNTRIES.length * 2 - historicalYears.length];
      const task = discoveryTasks[cycle % discoveryTasks.length]!;
      cycle += 1;
      await database`update public.music_success_fill_jobs set current_year=null, heartbeat_at=now() where id=${job.id}`;
      let discovered = 0;
      if (kworbPath) {
        discovered = await discoverKworb(kworbPath).catch((error) => {
          console.warn(`[Éxitos][FUENTE] Kworb ${kworbPath}: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        });
      } else if (chartCountry) {
        discovered = await discoverYouTubeMusicCharts(chartCountry).catch((error) => {
          console.warn(`[Éxitos][FUENTE] YouTube Music ${chartCountry}: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        });
      } else if (appleCountry) {
        discovered = await discoverAppleCharts(appleCountry).catch((error) => {
          console.warn(`[Éxitos][FUENTE] Apple ${appleCountry}: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        });
      } else if (historicalYear) {
        discovered = await discoverBillboardYear(historicalYear).catch((error) => {
          console.warn(`[Éxitos][FUENTE] Billboard ${historicalYear}: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        });
      } else if (popularTask) {
        try {
          discovered = await discoverListenBrainzTop(popularTask.range, popularTask.offset);
        } catch (error) {
          console.warn(`[Éxitos][TOP] fuente no disponible: ${error instanceof Error ? error.message : String(error)}; ` +
            `se usa MusicBrainz como respaldo.`);
          discovered = await discover(task.genre, task.page);
        }
      } else {
        discovered = await discover(task.genre, task.page);
      }
      const candidates = await database<Candidate[]>`
        select normalized_key, title, artist, release_year, primary_genre, youtube_video_id,
          musicbrainz_recording_id, musicbrainz_artist_id,
          listenbrainz_users, listenbrainz_listens
        from public.music_success_candidates
        where (release_year between ${fromYear} and ${toYear} or release_year is null)
          and (status in ('discovered', 'prioritized', 'id_found') or
            (status in ('accepted', 'error') and youtube_video_id is not null
              and youtube_views > 50000000 and attempts < 3))
          and not exists (
            select 1 from public.music_catalog catalog
            where catalog.normalized_key = music_success_candidates.normalized_key
          )
        order by
          (youtube_video_id is not null) desc,
          listenbrainz_listens desc nulls last,
          listenbrainz_users desc nulls last,
          md5(normalized_key || ${job.id})
        limit ${batchSize}
      `;
      await prioritize(candidates);
      const added = await processCandidates(candidates);
      await database`
        update public.music_success_fill_jobs set candidates_discovered=candidates_discovered+${discovered},
          candidates_checked=candidates_checked+${candidates.length}, successes_added=successes_added+${added},
          heartbeat_at=now() where id=${job.id}
      `;
      const source = kworbPath ? `kworb:${kworbPath}`
        : chartCountry ? `youtube-music-charts:${chartCountry}`
        : appleCountry ? `apple-music-charts:${appleCountry}`
        : historicalYear ? `billboard-year-end:${historicalYear}`
        : popularTask ? `listenbrainz-top:${popularTask.range}:${popularTask.offset}`
        : `musicbrainz:${task.genre}:${task.page + 1}`;
      console.info(`[Éxitos][CICLO] ciclo=${cycle} fuente=${source} ` +
        `descubiertas=${discovered} revisadas=${candidates.length} agregadas=${added}`);
  }
  await database`
    update public.music_success_fill_jobs set status='completed',
      completed_at=now(), heartbeat_at=now()
    where id=${job.id}
  `;
} catch (error) {
  await database`
    update public.music_success_fill_jobs set status='failed', last_error=${error instanceof Error ? error.message : String(error)},
      completed_at=now(), heartbeat_at=now() where id=${job.id}
  `;
  throw error;
} finally {
  await database.end();
}
