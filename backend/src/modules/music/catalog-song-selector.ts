import { randomUUID } from "node:crypto";
import type { SecretTrack } from "./music.types.js";
import { env } from "../../config/env.js";
import type { MusicCatalogRepository } from "./music-catalog.repository.js";
import { catalogKey, normalizeCatalogText } from "./catalog-utils.js";
import { calculateKnownness } from "./knownness.js";
import {
  type RequestedDifficulty,
  type SongCandidate,
  type SongConstraints,
  filterObjectiveCandidates,
  validateRankAndSelect,
} from "./song-ranking.service.js";

export interface CatalogFilters {
  genres: string[];
  languages: Array<"es" | "en" | "international">;
  yearFrom: number;
  yearTo: number;
  artists: string[];
  difficulties?: Exclude<RequestedDifficulty, "any">[];
  difficulty?: RequestedDifficulty;
}

export interface CatalogSelection {
  tracks: SecretTrack[];
  source: "catalog" | "gemini" | "local";
  usage?: { prompt: number; output: number; thoughts: number; total: number };
  fallbackReason?: string;
  strictConstraints: true;
}

function selectedDifficulties(filters: CatalogFilters) {
  if (filters.difficulties?.length) return filters.difficulties;
  return filters.difficulty && filters.difficulty !== "any" ? [filters.difficulty] : [];
}

function constraintsFrom(filters: CatalogFilters, prompt: string): SongConstraints {
  const difficulties = selectedDifficulties(filters);
  return {
    requiredArtist: filters.artists.length === 1 ? filters.artists[0] : "",
    allowedArtists: filters.artists,
    releaseYear: filters.yearFrom === filters.yearTo ? filters.yearFrom : 0,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    requiredGenre: filters.genres.length === 1 ? filters.genres[0] : "",
    allowedGenres: filters.genres,
    languages: filters.languages,
    allowedDifficulties: difficulties,
    difficulty: difficulties.length === 1 ? difficulties[0] : "any",
    subjectiveRequest: prompt,
  };
}

function matchesDifficulty(score: number, difficulties: Exclude<RequestedDifficulty, "any">[]) {
  if (!difficulties.length) return true;
  return difficulties.some((difficulty) =>
    difficulty === "easy" ? score >= 65 :
      difficulty === "medium" ? score >= 25 && score < 65 : score < 25);
}

export async function selectCatalogSongPack(
  era: string,
  excluded: string[],
  count: number,
  prompt: string,
  filters: CatalogFilters,
  repository: MusicCatalogRepository,
  embeddingOptions: { candidateTarget?: number; requirePrompt?: boolean } = {},
): Promise<CatalogSelection> {
  const constraints = constraintsFrom(filters, prompt);
  const difficulties = selectedDifficulties(filters);
  const selectionSeed = randomUUID();
  console.info(
    `[Música][1/4] Catálogo SQL aleatorio | años=${filters.yearFrom}-${filters.yearTo} ` +
    `géneros=${filters.genres.join(",") || "todos"} artistas=${filters.artists.join(",") || "todos"} ` +
    `semilla=${selectionSeed}.`,
  );
  const sqlCandidates = await repository.findRandomObjectiveCandidates({
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    genres: filters.genres,
    artists: filters.artists,
    excludedKeys: excluded.map(normalizeCatalogText),
    seed: selectionSeed,
    limit: 500,
  });
  const objectivelyValid = await filterObjectiveCandidates(
    sqlCandidates, constraints, era, excluded,
  );
  const objectiveCandidates = objectivelyValid.slice(0, 100);
  const cached = await repository.findMetrics(
    objectiveCandidates.map((track) => catalogKey(track.title, track.artist)),
  );
  const scored = objectiveCandidates.map((track) => {
    const metrics = cached.get(catalogKey(track.title, track.artist));
    const candidate = { ...track, ...metrics };
    const knownness = calculateKnownness(candidate);
    return {
      ...candidate,
      knownnessScore: knownness.score,
      knownnessConfidence: knownness.confidence,
      difficultyScore: Math.round(100 - knownness.score),
    } satisfies SongCandidate;
  });
  const eligible = scored.filter((track) => {
    const knownness = calculateKnownness(track);
    return knownness.eligible && matchesDifficulty(knownness.score, difficulties);
  });
  console.info(
    `[Música][2/4] ${scored.length} candidatas válidas; ${eligible.length} tienen ` +
    `al menos ${env.MUSIC_MIN_YOUTUBE_VIEWS.toLocaleString("en-US")} vistas de YouTube ` +
    `y dificultad compatible.`,
  );
  if (env.MUSIC_DEBUG) eligible.forEach((track) => console.info(
    `[Música][Knownness YouTube] ${track.title} — ${track.artist} | ` +
    `vistas=${track.youtubeViews?.toLocaleString("en-US")} score=${track.knownnessScore?.toFixed(1)}`,
  ));
  const ranked = await validateRankAndSelect(
    eligible, constraints, era, excluded, count, true, repository, embeddingOptions,
  );
  const tracks = ranked.slice(0, count);
  console.info(`[Música][FINAL] ${tracks.length}/${count} canciones aprobaron Knownness de YouTube:`);
  tracks.forEach((track, index) => console.info(
    `  Ronda ${index + 1}: [${track.source}] ${track.title} — ${track.artist} | ` +
    `youtube=${track.youtubeViews?.toLocaleString("en-US") ?? "n/d"} ` +
    `knownness=${track.knownnessScore?.toFixed(1)} método=YouTube ` +
    `embedding=${track.subjectiveSimilarity?.toFixed(4) ?? "omitido"}`,
  ));
  return { tracks, source: "catalog", strictConstraints: true };
}
