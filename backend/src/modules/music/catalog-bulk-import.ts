import { createDatabaseClient } from "../../database/client.js";
import { catalogKey } from "./catalog-utils.js";
import { fetchMusicBrainzWithRetry } from "./musicbrainz-catalog.js";
import { usesLatinAlphabet } from "./song-ranking.service.js";

interface Recording {
  id?: string;
  title?: string;
  score?: number;
  isrcs?: string[];
  "first-release-date"?: string;
  tags?: Array<{ name?: string; count?: number }>;
  genres?: Array<{ name?: string; count?: number }>;
  "artist-credit"?: Array<{ name?: string; joinphrase?: string; artist?: { id?: string } }>;
}

const GENRES = [
  "pop", "rock", "hip hop", "electronic", "r&b", "latin", "country", "reggae", "metal", "jazz",
];

function argument(name: string, fallback: number) {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=")[1];
  return value ? Number(value) : fallback;
}

function quote(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

const fromYear = argument("from", 1980);
const toYear = argument("to", 2026);
const modernTarget = argument("modern-count", 1000);
const legacyTarget = argument("legacy-count", 500);
if (![fromYear, toYear, modernTarget, legacyTarget].every(Number.isInteger) || fromYear > toYear) {
  throw new Error("Argumentos de importaciÃ³n invÃ¡lidos");
}

const database = createDatabaseClient(3);
const [job] = await database<{ id: string }[]>`
  insert into public.music_catalog_import_jobs (
    requested_from_year, requested_to_year, modern_target, legacy_target
  ) values (${fromYear}, ${toYear}, ${modernTarget}, ${legacyTarget})
  returning id
`;

async function fetchGenre(year: number, genre: string, limit: number) {
  const recordings: Recording[] = [];
  while (recordings.length < limit) {
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set(
      "query",
      `firstreleasedate:[${year}-01-01 TO ${year}-12-31] AND tag:${quote(genre)}`,
    );
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(Math.min(100, limit - recordings.length)));
    url.searchParams.set("offset", String(recordings.length));
    const response = await fetchMusicBrainzWithRetry(
      url, `importaciÃ³n ${year}/${genre}`, Math.floor(recordings.length / 100) + 1,
    );
    if (!response.ok) throw new Error(`MusicBrainz ${year}/${genre} HTTP ${response.status}`);
    const page = ((await response.json()) as { recordings?: Recording[] }).recordings ?? [];
    recordings.push(...page);
    if (!page.length) break;
  }
  return recordings;
}

async function saveBatch(year: number, genre: string, recordings: Recording[]) {
  const rawRows = recordings.flatMap((recording) => {
    const title = recording.title?.trim();
    const artist = recording["artist-credit"]
      ?.map((credit) => `${credit.name ?? ""}${credit.joinphrase ?? ""}`)
      .join("").trim();
    const releaseYear = Number(recording["first-release-date"]?.slice(0, 4));
    if (!recording.id || !title || !artist || releaseYear !== year) return [];
    if (!usesLatinAlphabet(title) || !usesLatinAlphabet(artist)) return [];
    const tags = [...(recording.tags ?? []), ...(recording.genres ?? [])]
      .filter((tag) => tag.name)
      .sort((left, right) => (right.count ?? 0) - (left.count ?? 0))
      .map((tag) => tag.name as string)
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .slice(0, 20);
    return [{
      normalized_key: catalogKey(title, artist),
      title,
      artist,
      musicbrainz_recording_id: recording.id,
      musicbrainz_artist_id: recording["artist-credit"]?.[0]?.artist?.id ?? null,
      release_year: releaseYear,
      primary_genre: genre,
      genres: [genre],
      tags,
      isrcs: recording.isrcs ?? [],
      source_names: ["musicbrainz"],
      source_score: recording.score ?? null,
      semantic_description: `${genre}; ${tags.join(", ") || "sin etiquetas adicionales"}; publicaciÃ³n ${year}`,
      import_job_id: job.id,
    }];
  });
  const rows = [...new Map(rawRows.map((row) => [row.normalized_key, row])).values()];
  if (!rows.length) return 0;
  const inserted = await database<{ inserted: number }[]>`
    with raw as (
      select * from jsonb_to_recordset(${database.json(rows)}) as item(
        normalized_key text, title text, artist text, musicbrainz_recording_id uuid,
        musicbrainz_artist_id uuid, release_year integer, primary_genre text,
        genres jsonb, tags jsonb, isrcs jsonb, source_names jsonb, source_score real,
        semantic_description text, import_job_id uuid
      )
    ), source as (
      select normalized_key, title, artist, musicbrainz_recording_id,
        musicbrainz_artist_id, release_year, primary_genre,
        array(select jsonb_array_elements_text(raw.genres)) as genres,
        array(select jsonb_array_elements_text(raw.tags)) as tags,
        array(select jsonb_array_elements_text(raw.isrcs)) as isrcs,
        array(select jsonb_array_elements_text(raw.source_names)) as source_names,
        source_score, semantic_description, import_job_id
      from raw
    ), upserted as (
      insert into public.music_catalog (
        normalized_key, title, artist, musicbrainz_recording_id, musicbrainz_artist_id,
        release_year, primary_genre, genres, tags, isrcs, source_names, source_score,
        semantic_description, import_job_id, catalog_status
      )
      select normalized_key, title, artist, musicbrainz_recording_id, musicbrainz_artist_id,
        release_year, primary_genre, genres, tags, isrcs, source_names, source_score,
        semantic_description, import_job_id, 'metadata_only'
      from source
      on conflict (normalized_key) do update set
        musicbrainz_recording_id = coalesce(public.music_catalog.musicbrainz_recording_id, excluded.musicbrainz_recording_id),
        musicbrainz_artist_id = coalesce(public.music_catalog.musicbrainz_artist_id, excluded.musicbrainz_artist_id),
        release_year = coalesce(public.music_catalog.release_year, excluded.release_year),
        primary_genre = coalesce(public.music_catalog.primary_genre, excluded.primary_genre),
        genres = array(select distinct value from unnest(public.music_catalog.genres || excluded.genres) value),
        tags = array(select distinct value from unnest(public.music_catalog.tags || excluded.tags) value),
        isrcs = array(select distinct value from unnest(public.music_catalog.isrcs || excluded.isrcs) value),
        source_names = array(select distinct value from unnest(public.music_catalog.source_names || excluded.source_names) value),
        source_score = greatest(public.music_catalog.source_score, excluded.source_score),
        semantic_description = coalesce(public.music_catalog.semantic_description, excluded.semantic_description),
        updated_at = now()
      returning 1
    ) select count(*)::int as inserted from upserted
  `;
  return inserted[0]?.inserted ?? 0;
}

try {
  let processed = 0;
  for (let year = fromYear; year <= toYear; year += 1) {
    const target = year >= 2020 ? modernTarget : legacyTarget;
    const perGenre = Math.ceil(target / GENRES.length);
    for (const genre of GENRES) {
      // El margen compensa alfabetos rechazados, fechas incompletas y duplicados.
      const recordings = await fetchGenre(year, genre, Math.ceil(perGenre * 1.25));
      processed += await saveBatch(year, genre, recordings);
    }
    const [{ count }] = await database<{ count: number }[]>`
      select count(*)::int as count from public.music_catalog where release_year = ${year}
    `;
    await database`
      insert into public.music_catalog_year_targets (
        release_year, target_count, imported_count, metadata_completed_at, updated_at
      ) values (${year}, ${target}, ${count}, ${count >= target ? new Date() : null}, now())
      on conflict (release_year) do update set
        target_count = excluded.target_count,
        imported_count = excluded.imported_count,
        metadata_completed_at = excluded.metadata_completed_at,
        updated_at = now()
    `;
    console.info(`[CATÃLOGO] aÃ±o=${year} guardadas=${count}/${target}.`);
  }
  await database`
    update public.music_catalog_import_jobs set
      status = 'completed', imported_count = ${processed}, completed_at = now()
    where id = ${job.id}
  `;
  console.info(`[CATÃLOGO] trabajo=${job.id} completado; upserts=${processed}.`);
} catch (error) {
  await database`
    update public.music_catalog_import_jobs set status = 'failed',
      error_message = ${error instanceof Error ? error.message : String(error)}, completed_at = now()
    where id = ${job.id}
  `;
  throw error;
} finally {
  await database.end();
}
