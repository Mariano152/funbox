import { createDatabaseClient } from "../../database/client.js";
import { searchItunes, type ItunesTrack } from "./itunes-client.js";
import { fetchMusicBrainzWithRetry } from "./musicbrainz-catalog.js";
import { normalizeCatalogText } from "./catalog-utils.js";

interface Track {
  normalized_key: string;
  title: string;
  artist: string;
  release_year: number;
  musicbrainz_recording_id: string | null;
  musicbrainz_artist_id: string | null;
}
interface MbTag { name?: string; count?: number }
interface MbArtistCredit { name?: string; joinphrase?: string; artist?: { id?: string; name?: string } }
interface MbRecording {
  id?: string; title?: string; "first-release-date"?: string;
  genres?: MbTag[]; tags?: MbTag[]; "artist-credit"?: MbArtistCredit[];
}
interface MbArtist { id?: string; genres?: MbTag[]; tags?: MbTag[] }
interface Metadata {
  primaryGenre?: string;
  genres?: string[];
  tags: string[];
  recordingMbid?: string | null;
  artistMbid?: string | null;
  source: string;
}

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = "true"] = argument.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const limit = Math.max(1, Number(args.get("limit") ?? 40_000));
const itunesWorkers = Math.max(1, Math.min(72, Number(args.get("itunes-workers") ?? 72)));
const skipItunes = args.get("skip-itunes") === "true";
const skipMusicBrainz = args.get("skip-musicbrainz") === "true";
const skipWikidata = args.get("skip-wikidata") === "true";
const retryItunes = args.get("retry-itunes") === "true";
const skipLastFm = args.get("skip-lastfm") === "true";
const lastFmRps = Math.max(1, Math.min(16, Number(args.get("lastfm-rps") ?? 2)));
const lastFmWorkers = Math.max(1, Math.min(72, Number(args.get("lastfm-workers") ?? 72)));
const musicBrainzWorkers = 72;
const database = createDatabaseClient(8);

function tokens(value: string) {
  return new Set(normalizeCatalogText(value)
    .replace(/\b(feat|featuring|ft|official|audio|video|lyrics|lyric|remaster(?:ed)?)\b/g, " ")
    .split(/\s+/).filter(Boolean));
}
function coverage(expected: Set<string>, actual: Set<string>) {
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return expected.size ? matches / expected.size : 0;
}
function ranked(values: MbTag[] | undefined) {
  return [...(values ?? [])]
    .filter((item) => item.name && (item.count ?? 1) > 0)
    .sort((left, right) => (right.count ?? 0) - (left.count ?? 0))
    .map((item) => item.name!.trim().toLowerCase());
}
function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim().toLowerCase()).filter(Boolean) as string[])];
}

const GENRE_RULES: Array<[RegExp, string]> = [
  [/\b(k[- ]?pop|korean pop)\b/i, "k-pop"], [/\b(j[- ]?pop|japanese pop)\b/i, "j-pop"],
  [/\b(reggaet[oó]n|urbano latino|latin urban)\b/i, "reggaetón"],
  [/\b(regional mexican|m[úu]sica mexicana|banda|norte[ñn]o|mariachi|corridos?)\b/i, "regional mexicano"],
  [/\b(afrobeats?|afrobeat)\b/i, "afrobeats"], [/\b(hip[- ]?hop)\b/i, "hip hop"],
  [/\b(rap|trap|drill)\b/i, "rap"], [/\b(r&b|rhythm and blues|contemporary r&b)\b/i, "r&b"],
  [/\b(salsa)\b/i, "salsa"], [/\b(cumbia)\b/i, "cumbia"], [/\b(bachata)\b/i, "bachata"],
  [/\b(reggae|dancehall|dub)\b/i, "reggae"], [/\b(country|bluegrass)\b/i, "country"],
  [/\b(punk|hardcore)\b/i, "punk"], [/\b(metal)\b/i, "metal"],
  [/\b(indie)\b/i, "indie"], [/\b(alternative)\b/i, "alternativa"],
  [/\b(disco)\b/i, "disco"], [/\b(funk)\b/i, "funk"], [/\b(soul|motown)\b/i, "soul"],
  [/\b(jazz)\b/i, "jazz"], [/\b(blues)\b/i, "blues"],
  [/\b(electronic|electronica|edm|house|techno|trance|dubstep|ambient)\b/i, "electrónica"],
  [/\b(dance)\b/i, "dance"], [/\b(rock)\b/i, "rock"], [/\b(pop)\b/i, "pop"],
  [/\b(latin|latino|tropical)\b/i, "latin"],
  [/\b(christian|gospel|worship)\b/i, "gospel"], [/\b(soundtrack|film score)\b/i, "soundtrack"],
  [/\b(folk|singer.songwriter)\b/i, "folk"], [/\b(classical|opera)\b/i, "classical"],
  [/\b(world)\b/i, "world"], [/\b(children|kids)\b/i, "children"],
];

function normalizeGenre(rawValues: string[]) {
  const normalized = unique(rawValues.flatMap((value) =>
    GENRE_RULES.flatMap(([pattern, genre]) => pattern.test(value) ? [genre] : [])));
  return normalized.length ? normalized : unique(rawValues).slice(0, 5);
}

function selectItunes(track: Track, results: ItunesTrack[]) {
  const matches = results.flatMap((result) => {
    if (result.kind !== "song" || !result.primaryGenreName) return [];
    const titleScore = coverage(tokens(track.title), tokens(result.trackName ?? ""));
    const artistScore = coverage(tokens(track.artist), tokens(result.artistName ?? ""));
    if (titleScore < 0.7 || artistScore < 0.55) return [];
    const year = Number(result.releaseDate?.slice(0, 4));
    const yearScore = Number.isInteger(year) && Math.abs(year - track.release_year) <= 2 ? 0.1 : 0;
    return [{ result, score: titleScore * 0.6 + artistScore * 0.3 + yearScore }];
  }).sort((left, right) => right.score - left.score)[0]?.result;
  if (matches?.primaryGenreName) return { genre: matches.primaryGenreName, source: "itunes-track" };

  const artistGenres = results.filter((result) => result.kind === "song" && result.primaryGenreName &&
    coverage(tokens(track.artist), tokens(result.artistName ?? "")) >= 0.65)
    .map((result) => result.primaryGenreName!);
  const frequency = new Map<string, number>();
  for (const genre of artistGenres) frequency.set(genre, (frequency.get(genre) ?? 0) + 1);
  const fallback = [...frequency].sort((left, right) => right[1] - left[1])[0]?.[0];
  return fallback ? { genre: fallback, source: "itunes-artist" } : null;
}

async function enrichItunes(track: Track): Promise<Metadata | null> {
  const result = selectItunes(track, await searchItunes(`${track.title} ${track.artist}`, { limit: 15 }));
  if (!result) return null;
  const genres = normalizeGenre([result.genre]);
  return genres[0] ? {
    primaryGenre: genres[0], genres, tags: unique([result.genre]), source: result.source,
  } : null;
}

let lastFmQueue: Promise<void> = Promise.resolve();
let lastFmStartedAt = 0;
const lastFmCache = new Map<string, Promise<string[]>>();
function htmlText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'").replaceAll("&quot;", '"').replace(/\s+/g, " ").trim();
}
function fetchLastFmArtistTags(artist: string) {
  const key = normalizeCatalogText(artist);
  const cached = lastFmCache.get(key);
  if (cached) return cached;
  const request = (async () => {
    const scheduledStart = lastFmQueue.then(async () => {
      const wait = Math.max(0, 1_000 / lastFmRps - (Date.now() - lastFmStartedAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastFmStartedAt = Date.now();
    });
    lastFmQueue = scheduledStart.catch(() => undefined);
    await scheduledStart;
    const response = await fetch(`https://www.last.fm/music/${encodeURIComponent(artist)}/+tags`, {
      headers: { "User-Agent": "Funbox/0.1 music metadata enrichment" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    return unique([...html.matchAll(/<h3[^>]*class="[^"]*big-tags-item-name[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => htmlText(match[1] ?? "")))
      .filter((tag) => tag && !/^(seen live|favorites?|spotify|under \d+ listeners)$/i.test(tag))
      .slice(0, 20);
  })();
  lastFmCache.set(key, request);
  return request;
}

async function enrichLastFm(track: Track): Promise<Metadata | null> {
  const artists = unique([
    track.artist,
    ...track.artist.split(/\s+(?:&|and|y|x|feat\.?|ft\.?)\s+|,\s*/i).map((value) => value.trim()),
  ]).slice(0, 4);
  for (const artist of artists) {
    const tags = await fetchLastFmArtistTags(artist);
    const genres = normalizeGenre(tags).slice(0, 5);
    if (genres[0]) return {
      primaryGenre: genres[0], genres, tags, source: artist === track.artist
        ? "lastfm-artist" : "lastfm-primary-artist",
    };
  }
  return null;
}

function quote(value: string) { return `"${value.replaceAll('"', '\\"')}"`; }
function selectMbRecording(track: Track, recordings: MbRecording[]) {
  return recordings.flatMap((recording) => {
    const artist = recording["artist-credit"]?.map((credit) =>
      `${credit.name ?? ""}${credit.joinphrase ?? ""}`).join("") ?? "";
    const titleScore = coverage(tokens(track.title), tokens(recording.title ?? ""));
    const artistScore = coverage(tokens(track.artist), tokens(artist));
    const year = Number(recording["first-release-date"]?.slice(0, 4));
    if (!recording.id || titleScore < 0.7 || artistScore < 0.55) return [];
    return [{ recording, score: titleScore * 0.6 + artistScore * 0.3 +
      (Number.isInteger(year) && Math.abs(year - track.release_year) <= 2 ? 0.1 : 0) }];
  }).sort((left, right) => right.score - left.score)[0]?.recording;
}

const artistCache = new Map<string, Promise<{ genres: string[]; tags: string[] }>>();
async function musicBrainzArtistMetadata(artistMbid: string) {
  const cached = artistCache.get(artistMbid);
  if (cached) return cached;
  const request = (async () => {
    const url = new URL(`https://musicbrainz.org/ws/2/artist/${artistMbid}`);
    url.searchParams.set("inc", "genres+tags"); url.searchParams.set("fmt", "json");
    const response = await fetchMusicBrainzWithRetry(url, "géneros de artista");
    if (!response.ok) return { genres: [], tags: [] };
    const artist = await response.json() as MbArtist;
    return { genres: ranked(artist.genres), tags: ranked(artist.tags) };
  })();
  artistCache.set(artistMbid, request);
  return request;
}

async function enrichMusicBrainz(track: Track): Promise<Metadata | null> {
  let recording: MbRecording | undefined;
  if (track.musicbrainz_recording_id) {
    const url = new URL(`https://musicbrainz.org/ws/2/recording/${track.musicbrainz_recording_id}`);
    url.searchParams.set("inc", "genres+tags+artist-credits+releases"); url.searchParams.set("fmt", "json");
    const response = await fetchMusicBrainzWithRetry(url, "géneros de grabación");
    if (response.ok) recording = await response.json() as MbRecording;
  } else {
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", `recording:${quote(track.title)} AND artist:${quote(track.artist)}`);
    url.searchParams.set("fmt", "json"); url.searchParams.set("limit", "5");
    const response = await fetchMusicBrainzWithRetry(url, "búsqueda para género");
    if (response.ok) {
      recording = selectMbRecording(track, ((await response.json()) as { recordings?: MbRecording[] }).recordings ?? []);
    }
  }
  const recordingGenres = ranked(recording?.genres);
  const recordingTags = ranked(recording?.tags);
  const artistMbid = recording?.["artist-credit"]?.[0]?.artist?.id ?? track.musicbrainz_artist_id;
  let artistGenres: string[] = [];
  let artistTags: string[] = [];
  if ((!recordingGenres.length && !normalizeGenre(recordingTags).length) && artistMbid) {
    const artist = await musicBrainzArtistMetadata(artistMbid);
    artistGenres = artist.genres; artistTags = artist.tags;
  }
  const rawGenres = unique([...recordingGenres, ...artistGenres]);
  const allTags = unique([...recordingTags, ...artistTags]).slice(0, 20);
  const genres = normalizeGenre([...rawGenres, ...allTags]).slice(0, 5);
  if (!genres[0]) return recording ? {
    tags: unique([...rawGenres, ...allTags]).slice(0, 20),
    recordingMbid: recording.id ?? track.musicbrainz_recording_id,
    artistMbid, source: "musicbrainz-identity",
  } : null;
  return {
    primaryGenre: genres[0], genres, tags: unique([...rawGenres, ...allTags]).slice(0, 20),
    recordingMbid: recording?.id ?? track.musicbrainz_recording_id,
    artistMbid, source: recordingGenres.length || normalizeGenre(recordingTags).length
      ? "musicbrainz-recording" : "musicbrainz-artist",
  };
}

async function pending(sourceMarker: string) {
  return database<Track[]>`
    select normalized_key, title, artist, release_year,
      musicbrainz_recording_id, musicbrainz_artist_id
    from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and (primary_genre is null or cardinality(genres) = 0)
      and not (${sourceMarker} = any(source_names))
    order by youtube_views desc nulls last, normalized_key
    limit ${limit}
  `;
}

async function save(track: Track, marker: string, metadata: Metadata | null, error?: unknown) {
  const sources = [marker, metadata?.source].filter((value): value is string => Boolean(value));
  await database`
    update public.music_catalog set
      primary_genre = coalesce(primary_genre, ${metadata?.primaryGenre ?? null}),
      genres = case when cardinality(genres) = 0 then ${metadata?.genres ?? []} else genres end,
      tags = (select array(select distinct value from unnest(tags || ${metadata?.tags ?? []}::text[]) value limit 20)),
      musicbrainz_recording_id = coalesce(musicbrainz_recording_id, ${metadata?.recordingMbid ?? null}::uuid),
      musicbrainz_artist_id = coalesce(musicbrainz_artist_id, ${metadata?.artistMbid ?? null}::uuid),
      source_names = (select array(select distinct value from unnest(source_names ||
        ${sources}::text[]) value)),
      enrichment_error = ${error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null},
      metadata_checked_at = now(), updated_at = now()
    where normalized_key = ${track.normalized_key}
  `;
}

async function runPhase(
  label: string, marker: string, workers: number,
  enrich: (track: Track) => Promise<Metadata | null>,
) {
  const tracks = await pending(marker);
  let cursor = 0;
  let resolved = 0;
  let errors = 0;
  await Promise.all(Array.from({ length: Math.min(workers, tracks.length) }, async () => {
    while (true) {
      const track = tracks[cursor++];
      if (!track) return;
      try {
        const metadata = await enrich(track);
        await save(track, marker, metadata);
        if (metadata?.primaryGenre) resolved += 1;
      } catch (error) {
        errors += 1;
        await save(track, `${marker}-error`, null, error);
      }
      const reviewed = cursor > tracks.length ? tracks.length : cursor;
      if (reviewed % 25 === 0 || reviewed === tracks.length) {
        const [{ missing }] = await database<Array<{ missing: number }>>`
          select count(*)::int as missing from public.music_catalog
          where release_year between 1980 and 2026 and youtube_views > 50000000
            and (primary_genre is null or cardinality(genres) = 0)
        `;
        console.info(`[GÉNEROS][${label}] revisadas=${reviewed}/${tracks.length} ` +
          `resueltas=${resolved} errores=${errors} faltantes=${missing}`);
      }
    }
  }));
}

async function propagateVerifiedArtistGenres() {
  const result = await database`
    with genre_counts as (
      select lower(trim(artist)) as artist_key, primary_genre, count(*) as genre_count,
        max(youtube_views) as max_views
      from public.music_catalog
      where primary_genre is not null and cardinality(genres) > 0
      group by lower(trim(artist)), primary_genre
    ), dominant as (
      select distinct on (artist_key) artist_key, primary_genre
      from genre_counts order by artist_key, genre_count desc, max_views desc
    ), representative as (
      select distinct on (lower(trim(c.artist))) lower(trim(c.artist)) as artist_key,
        c.genres, c.tags
      from public.music_catalog c join dominant d
        on d.artist_key=lower(trim(c.artist)) and d.primary_genre=c.primary_genre
      order by lower(trim(c.artist)), cardinality(c.tags) desc, c.youtube_views desc nulls last
    )
    update public.music_catalog pending set
      primary_genre = dominant.primary_genre,
      genres = representative.genres,
      tags = representative.tags,
      source_names = (select array(select distinct value from unnest(
        pending.source_names || array['catalog-artist-genre']) value)),
      metadata_checked_at=now(), updated_at=now()
    from dominant join representative using (artist_key)
    where lower(trim(pending.artist))=dominant.artist_key
      and pending.release_year between 1980 and 2026 and pending.youtube_views > 50000000
      and (pending.primary_genre is null or cardinality(pending.genres)=0)
  `;
  const [{ missing }] = await database<Array<{ missing: number }>>`
    select count(*)::int as missing from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and (primary_genre is null or cardinality(genres)=0)
  `;
  console.info(`[GÉNEROS][ARTISTA] propagadas=${result.count} faltantes=${missing}`);
}

async function enrichWikidataArtists() {
  const artists = await database<Array<{ musicbrainz_artist_id: string }>>`
    select distinct musicbrainz_artist_id::text as musicbrainz_artist_id
    from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and (primary_genre is null or cardinality(genres)=0)
      and musicbrainz_artist_id is not null
      and not ('wikidata-genre-checked' = any(source_names))
  `;
  let resolvedArtists = 0;
  for (let index = 0; index < artists.length; index += 50) {
    const ids = artists.slice(index, index + 50).map((row) => row.musicbrainz_artist_id);
    const values = ids.map((id) => JSON.stringify(id)).join(" ");
    const query = `SELECT ?mbid ?genreLabel WHERE {
      VALUES ?mbid { ${values} }
      ?artist wdt:P434 ?mbid; wdt:P136 ?genre.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es". }
    }`;
    const url = new URL("https://query.wikidata.org/sparql");
    url.searchParams.set("query", query); url.searchParams.set("format", "json");
    let bindings: Array<{ mbid?: { value?: string }; genreLabel?: { value?: string } }> = [];
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/sparql-results+json", "User-Agent": "Funbox/0.1 music metadata enrichment" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
      bindings = ((await response.json()) as { results?: { bindings?: typeof bindings } }).results?.bindings ?? [];
    } catch (error) {
      console.warn(`[GÉNEROS][WIKIDATA] lote=${index / 50 + 1} ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      continue;
    }
    const byArtist = new Map<string, string[]>();
    for (const binding of bindings) {
      const id = binding.mbid?.value;
      const genre = binding.genreLabel?.value;
      if (id && genre) byArtist.set(id, [...(byArtist.get(id) ?? []), genre]);
    }
    for (const id of ids) {
      const raw = unique(byArtist.get(id) ?? []);
      const genres = normalizeGenre(raw).slice(0, 5);
      if (genres.length) resolvedArtists += 1;
      await database`
        update public.music_catalog set
          primary_genre=coalesce(primary_genre, ${genres[0] ?? null}),
          genres=case when cardinality(genres)=0 then ${genres} else genres end,
          tags=(select array(select distinct value from unnest(tags || ${raw}::text[]) value limit 20)),
          source_names=(select array(select distinct value from unnest(source_names ||
            ${["wikidata-genre-checked", ...(genres.length ? ["wikidata-artist"] : [])]}::text[]) value)),
          metadata_checked_at=now(), updated_at=now()
        where musicbrainz_artist_id=${id}::uuid
          and (primary_genre is null or cardinality(genres)=0)
      `;
    }
    console.info(`[GÉNEROS][WIKIDATA] artistas=${Math.min(index + 50, artists.length)}/${artists.length} ` +
      `resueltos=${resolvedArtists}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

try {
  console.info(`[GÉNEROS][CONFIG] trabajadores iTunes=${itunesWorkers} Last.fm=${lastFmWorkers} ` +
    `MusicBrainz=${musicBrainzWorkers} (cola global 1/1.2s) límite=${limit}`);
  if (retryItunes) {
    const reset = await database`
      update public.music_catalog set source_names=array_remove(source_names, 'itunes-genre-checked'),
        enrichment_error=null, updated_at=now()
      where release_year between 1980 and 2026 and youtube_views > 50000000
        and (primary_genre is null or cardinality(genres)=0)
        and 'itunes-genre-checked' = any(source_names)
    `;
    console.info(`[GÉNEROS][ITUNES] reencoladas=${reset.count}`);
  }
  await propagateVerifiedArtistGenres();
  if (!skipWikidata) {
    await enrichWikidataArtists();
    await propagateVerifiedArtistGenres();
  }
  if (!skipLastFm) {
    await runPhase("LASTFM", "lastfm-genre-checked", lastFmWorkers, enrichLastFm);
    await propagateVerifiedArtistGenres();
  }
  if (!skipItunes) await runPhase("ITUNES", "itunes-genre-checked", itunesWorkers, enrichItunes);
  if (!skipMusicBrainz) await runPhase(
    "MUSICBRAINZ", "musicbrainz-genre-checked", musicBrainzWorkers, enrichMusicBrainz,
  );
} finally {
  await database.end();
}
