import type { DatabaseClient } from "../../database/client.js";
import type { KnownnessSignals } from "./knownness.js";
import type { SongCandidate } from "./song-ranking.service.js";
import { genreAliasesFor, genreExclusionsFor } from "./genre-taxonomy.js";

export interface CatalogTrackMetrics extends KnownnessSignals {
  normalizedKey: string;
  knownnessScore?: number | null;
  knownnessConfidence?: number | null;
}

export class MusicCatalogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findRandomObjectiveCandidates(input: {
    yearFrom: number;
    yearTo: number;
    genres: string[];
    artists: string[];
    excludedKeys: string[];
    seed: string;
    limit: number;
  }): Promise<SongCandidate[]> {
    const genreAliases = genreAliasesFor(input.genres);
    const genreExclusions = genreExclusionsFor(input.genres);
    const artists = input.artists.map((artist) => artist.toLowerCase());
    const rows = await this.database<Array<{
      normalized_key: string;
      title: string;
      artist: string;
      release_year: number;
      primary_genre: string | null;
      genres: string[] | null;
      tags: string[] | null;
      semantic_description: string | null;
      musicbrainz_recording_id: string | null;
      musicbrainz_artist_id: string | null;
      youtube_video_id: string;
      youtube_views: number;
      youtube_published_at: Date | null;
      youtube_checked_at: Date | null;
      knownness_score: number | null;
      knownness_confidence: number | null;
    }>>`
      select normalized_key, title, artist, release_year, primary_genre, genres, tags,
        semantic_description, musicbrainz_recording_id, musicbrainz_artist_id,
        youtube_video_id, youtube_views, youtube_published_at, youtube_checked_at,
        knownness_score, knownness_confidence
      from public.music_catalog
      where release_year between ${input.yearFrom} and ${input.yearTo}
        and catalog_status <> 'rejected'
        and youtube_video_id is not null
        and youtube_views is not null
        and youtube_views >= 50000000
        and (${genreAliases.length === 0} or exists (
          select 1 from unnest(coalesce(genres, array[]::text[]) ||
            array[coalesce(primary_genre, '')]) as catalog_genre
          where trim(regexp_replace(translate(lower(catalog_genre),
            'áéíóúüñ&', 'aeiouun '), '[^a-z0-9]+', ' ', 'g')) = any(${genreAliases}::text[])
        ))
        and (${genreExclusions.length === 0} or trim(regexp_replace(translate(lower(
          coalesce(primary_genre, '')), 'áéíóúüñ&', 'aeiouun '),
          '[^a-z0-9]+', ' ', 'g')) <> all(${genreExclusions}::text[]))
        and (${artists.length === 0} or lower(artist) = any(${artists}::text[]))
        and (${input.excludedKeys.length === 0} or
          normalized_key <> all(${input.excludedKeys}::text[]))
      order by md5(normalized_key || ${input.seed})
      limit ${input.limit}
    `;
    return rows.map((row) => ({
      source: "catalog",
      title: row.title,
      artist: row.artist,
      releaseYear: row.release_year,
      genre: row.primary_genre ?? row.genres?.[0] ?? "",
      tags: row.tags ?? [],
      semanticDescription: row.semantic_description ?? "",
      difficultyScore: Math.round(100 - (row.knownness_score ?? 50)),
      recordingMbid: row.musicbrainz_recording_id ?? undefined,
      artistMbid: row.musicbrainz_artist_id ?? undefined,
      youtubeVideoId: row.youtube_video_id,
      youtubeViews: row.youtube_views,
      youtubePublishedAt: row.youtube_published_at,
      youtubeCheckedAt: row.youtube_checked_at,
      knownnessScore: row.knownness_score ?? undefined,
      knownnessConfidence: row.knownness_confidence ?? undefined,
    }));
  }

  async findMetrics(keys: string[]) {
    if (!keys.length) return new Map<string, CatalogTrackMetrics>();
    const rows = await this.database<Array<{
      normalized_key: string;
      listenbrainz_users: number | null;
      listenbrainz_listens: number | null;
      artist_users: number | null;
      artist_listens: number | null;
      apple_best_rank: number | null;
      apple_market_count: number | null;
      apple_days_in_chart: number | null;
      youtube_views: number | null;
      youtube_video_id: string | null;
      youtube_published_at: Date | null;
      youtube_previous_views: number | null;
      youtube_previous_checked_at: Date | null;
      youtube_checked_at: Date | null;
      knownness_score: number | null;
      knownness_confidence: number | null;
    }>>`
      select normalized_key, listenbrainz_users, listenbrainz_listens,
        artist_users, artist_listens, apple_best_rank, apple_market_count,
        apple_days_in_chart, youtube_video_id, youtube_views, youtube_published_at,
        youtube_previous_views, youtube_previous_checked_at, youtube_checked_at,
        knownness_score, knownness_confidence
      from public.music_catalog
      where normalized_key in ${this.database(keys)}
    `;
    return new Map(rows.map((row) => [row.normalized_key, {
      normalizedKey: row.normalized_key,
      listenbrainzUsers: row.listenbrainz_users,
      listenbrainzListens: row.listenbrainz_listens,
      artistUsers: row.artist_users,
      artistListens: row.artist_listens,
      appleBestRank: row.apple_best_rank,
      appleMarketCount: row.apple_market_count,
      appleDaysInChart: row.apple_days_in_chart,
      youtubeViews: row.youtube_views,
      youtubeVideoId: row.youtube_video_id,
      youtubePublishedAt: row.youtube_published_at,
      youtubePreviousViews: row.youtube_previous_views,
      youtubePreviousCheckedAt: row.youtube_previous_checked_at,
      youtubeCheckedAt: row.youtube_checked_at,
      knownnessScore: row.knownness_score,
      knownnessConfidence: row.knownness_confidence,
    }]));
  }

  async saveYouTube(
    key: string,
    title: string,
    artist: string,
    video: { videoId: string; viewCount?: number; publishedAt?: string },
  ) {
    await this.database`
      insert into public.music_catalog (
        normalized_key, title, artist, youtube_video_id, youtube_views,
        youtube_published_at, youtube_checked_at
      ) values (
        ${key}, ${title}, ${artist}, ${video.videoId}, ${video.viewCount ?? null},
        ${video.publishedAt ?? null}, now()
      )
      on conflict (normalized_key) do update set
        youtube_video_id = excluded.youtube_video_id,
        youtube_previous_views = public.music_catalog.youtube_views,
        youtube_previous_checked_at = public.music_catalog.youtube_checked_at,
        youtube_views = excluded.youtube_views,
        youtube_published_at = excluded.youtube_published_at,
        youtube_checked_at = now(),
        updated_at = now()
    `;
  }

  async saveCandidate(track: SongCandidate) {
    await this.database`
      insert into public.music_catalog (
        normalized_key, title, artist, musicbrainz_recording_id,
        musicbrainz_artist_id, release_year, genres, tags,
        listenbrainz_users, listenbrainz_listens, artist_users, artist_listens,
        apple_best_rank, apple_market_count, knownness_score, knownness_confidence
      ) values (
        ${track.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim() + " " + track.artist.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()},
        ${track.title}, ${track.artist}, ${track.recordingMbid ?? null},
        ${track.artistMbid ?? null}, ${track.releaseYear}, ${[track.genre].filter(Boolean)},
        ${track.tags ?? []},
        ${track.listenbrainzUsers ?? null},
        ${track.listenbrainzListens ?? null}, ${track.artistUsers ?? null},
        ${track.artistListens ?? null}, ${track.appleBestRank ?? null},
        ${track.appleMarketCount ?? null}, ${track.knownnessScore ?? null},
        ${track.knownnessConfidence ?? null}
      )
      on conflict (normalized_key) do update set
        title = excluded.title, artist = excluded.artist,
        musicbrainz_recording_id = coalesce(excluded.musicbrainz_recording_id, public.music_catalog.musicbrainz_recording_id),
        musicbrainz_artist_id = coalesce(excluded.musicbrainz_artist_id, public.music_catalog.musicbrainz_artist_id),
        release_year = excluded.release_year, genres = excluded.genres, tags = excluded.tags,
        listenbrainz_users = coalesce(excluded.listenbrainz_users, public.music_catalog.listenbrainz_users),
        listenbrainz_listens = coalesce(excluded.listenbrainz_listens, public.music_catalog.listenbrainz_listens),
        artist_users = coalesce(excluded.artist_users, public.music_catalog.artist_users),
        artist_listens = coalesce(excluded.artist_listens, public.music_catalog.artist_listens),
        apple_best_rank = coalesce(excluded.apple_best_rank, public.music_catalog.apple_best_rank),
        apple_market_count = coalesce(excluded.apple_market_count, public.music_catalog.apple_market_count),
        knownness_score = excluded.knownness_score,
        knownness_confidence = excluded.knownness_confidence, updated_at = now()
    `;
  }

  async findEmbeddings(
    keys: string[],
    model: string,
    task: string,
  ) {
    if (!keys.length) return new Map<string, { hash: string; vector: number[] }>();
    const rows = await this.database<Array<{
      normalized_key: string;
      embedding_description_hash: string;
      embedding: number[];
    }>>`
      select normalized_key, embedding_description_hash, embedding
      from public.music_catalog
      where normalized_key in ${this.database(keys)}
        and embedding_model = ${model}
        and embedding_task = ${task}
        and embedding is not null
        and embedding_description_hash is not null
    `;
    return new Map(rows.map((row) => [row.normalized_key, {
      hash: row.embedding_description_hash,
      vector: row.embedding.map(Number),
    }]));
  }

  async findPromptEmbedding(key: string, model: string, task: string) {
    const [row] = await this.database<Array<{
      semantic_text: string;
      embedding: number[];
    }>>`
      select semantic_text, embedding
      from public.music_prompt_embeddings
      where prompt_key = ${key}
        and embedding_model = ${model}
        and embedding_task = ${task}
      limit 1
    `;
    return row ? {
      semanticText: row.semantic_text,
      vector: row.embedding.map(Number),
    } : undefined;
  }

  async savePromptEmbedding(input: {
    key: string;
    prompt: string;
    semanticText: string;
    model: string;
    task: string;
    vector: number[];
  }) {
    await this.database`
      insert into public.music_prompt_embeddings (
        prompt_key, prompt_text, semantic_text, embedding_model, embedding_task,
        embedding, updated_at
      ) values (
        ${input.key}, ${input.prompt}, ${input.semanticText}, ${input.model},
        ${input.task}, ${input.vector}, now()
      )
      on conflict (prompt_key, embedding_model, embedding_task) do update set
        prompt_text = excluded.prompt_text,
        semantic_text = excluded.semantic_text,
        embedding = excluded.embedding,
        updated_at = now()
    `;
  }

  async saveEmbedding(input: {
    key: string;
    title: string;
    artist: string;
    model: string;
    task: string;
    hash: string;
    vector: number[];
  }) {
    await this.database`
      insert into public.music_catalog (
        normalized_key, title, artist, embedding_model, embedding_task,
        embedding_description_hash, embedding, embedding_updated_at
      ) values (
        ${input.key}, ${input.title}, ${input.artist}, ${input.model}, ${input.task},
        ${input.hash}, ${input.vector}, now()
      )
      on conflict (normalized_key) do update set
        title = excluded.title,
        artist = excluded.artist,
        embedding_model = excluded.embedding_model,
        embedding_task = excluded.embedding_task,
        embedding_description_hash = excluded.embedding_description_hash,
        embedding = excluded.embedding,
        embedding_updated_at = now(),
        updated_at = now()
    `;
  }
}
