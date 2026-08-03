import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(1);
try {
  const [row] = await database<Array<{
    total: number; with_genre: number; missing: number; with_tags: number;
    itunes_checked: number; musicbrainz_checked: number; wikidata_ready: number;
  }>>`
    select count(*)::int as total,
      count(*) filter (where primary_genre is not null and cardinality(genres) > 0)::int as with_genre,
      count(*) filter (where primary_genre is null or cardinality(genres) = 0)::int as missing,
      count(*) filter (where cardinality(tags) > 0)::int as with_tags,
      count(*) filter (where 'itunes-genre-checked' = any(source_names))::int as itunes_checked,
      count(*) filter (where 'musicbrainz-genre-checked' = any(source_names))::int as musicbrainz_checked
      ,count(*) filter (where (primary_genre is null or cardinality(genres)=0)
        and musicbrainz_artist_id is not null
        and not ('wikidata-genre-checked' = any(source_names)))::int as wikidata_ready
    from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000 and catalog_status <> 'rejected'
  `;
  console.info(`[GÉNEROS][PROGRESO] género=${row?.with_genre ?? 0}/${row?.total ?? 0} ` +
    `faltantes=${row?.missing ?? 0} conEtiquetas=${row?.with_tags ?? 0} ` +
    `iTunesRevisadas=${row?.itunes_checked ?? 0} MusicBrainzRevisadas=${row?.musicbrainz_checked ?? 0} ` +
    `listasParaWikidata=${row?.wikidata_ready ?? 0}`);
  const errors = await database<Array<{ enrichment_error: string; total: number }>>`
    select enrichment_error, count(*)::int as total from public.music_catalog
    where enrichment_error is not null and (
      'itunes-genre-checked' = any(source_names) or 'itunes-genre-checked-error' = any(source_names)
    ) and catalog_status <> 'rejected'
    group by enrichment_error order by total desc limit 5
  `;
  errors.forEach((error) => console.info(`[GÉNEROS][ERROR] cantidad=${error.total} ${error.enrichment_error}`));
  const samples = await database<Array<{ title: string; artist: string; youtube_video_id: string }>>`
    select title, artist, youtube_video_id from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and catalog_status <> 'rejected'
      and (primary_genre is null or cardinality(genres)=0)
    order by youtube_views desc limit 3
  `;
  samples.forEach((sample) => console.info(
    `[GÉNEROS][PENDIENTE] id=${sample.youtube_video_id} ${sample.artist} — ${sample.title}`,
  ));
} finally {
  await database.end();
}
