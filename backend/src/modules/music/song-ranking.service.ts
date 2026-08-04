import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import type { MusicCatalogRepository } from "./music-catalog.repository.js";
import { catalogKey, normalizeCatalogText } from "./catalog-utils.js";
import type { SecretTrack } from "./music.types.js";
import { genreMatches } from "./genre-taxonomy.js";
import {
  interpretMusicIntent,
  positiveIntentEmbeddingText,
} from "./music-intent.service.js";

export type RequestedDifficulty = "any" | "easy" | "medium" | "hard";

export interface SongConstraints {
  requiredArtist: string;
  releaseYear: number;
  requiredGenre: string;
  allowedArtists?: string[];
  yearFrom?: number;
  yearTo?: number;
  allowedGenres?: string[];
  languages?: Array<"es" | "en" | "international">;
  allowedDifficulties?: Array<Exclude<RequestedDifficulty, "any">>;
  difficulty: RequestedDifficulty;
  subjectiveRequest: string;
}

export interface SongCandidate extends SecretTrack {
  source?: "catalog" | "gemini" | "apple" | "musicbrainz";
  releaseYear: number;
  genre: string;
  semanticDescription: string;
  difficultyScore: number;
  language?: string;
  recordingMbid?: string;
  artistMbid?: string;
  tags?: string[];
  listenbrainzUsers?: number | null;
  listenbrainzListens?: number | null;
  artistUsers?: number | null;
  artistListens?: number | null;
  appleBestRank?: number | null;
  appleMarketCount?: number | null;
  appleDaysInChart?: number | null;
  youtubeViews?: number | null;
  youtubeVideoId?: string | null;
  youtubePublishedAt?: string | Date | null;
  youtubePreviousViews?: number | null;
  youtubePreviousCheckedAt?: string | Date | null;
  youtubeCheckedAt?: string | Date | null;
  knownnessScore?: number;
  knownnessConfidence?: number;
  subjectiveSimilarity?: number;
  rankingScore?: number;
}

export interface EmbeddingSelectionOptions {
  candidateTarget?: number;
  requirePrompt?: boolean;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isAlternateVersion(value: string) {
  return /\b(remix|remaster(?:ed)?|live|acoustic|karaoke|sped up|slowed|nightcore|cover|instrumental|radio(?: edit)?|mix|rock version|extended(?: version)?|re-recorded|deluxe version)\b/i.test(value);
}

export function usesLatinAlphabet(value: string) {
  for (const character of value.normalize("NFC")) {
    if (/\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)) return false;
  }
  return true;
}

function eraMatches(year: number, era: string) {
  const currentYear = new Date().getUTCFullYear();
  if (era === "80s") return year >= 1980 && year <= 1989;
  if (era === "90s") return year >= 1990 && year <= 1999;
  if (era === "2000s") return year >= 2000 && year <= 2009;
  if (era === "modern") return year >= 2010;
  if (era === "current-hits") return year >= currentYear - 1;
  return true;
}

async function validateCandidate(
  candidate: SongCandidate,
  constraints: SongConstraints,
  era: string,
): Promise<{ track?: SongCandidate; reason?: string }> {
  const rejected = (reason: string) => ({ reason });
  if (!usesLatinAlphabet(candidate.title)) {
    return rejected("título escrito en un alfabeto no latino");
  }
  if (!usesLatinAlphabet(candidate.artist)) {
    return rejected("artista escrito en un alfabeto no latino");
  }
  if (isAlternateVersion(candidate.title)) return rejected("versión no permitida");
  try {
    const results = ["catalog", "apple", "musicbrainz"].includes(candidate.source ?? "")
      ? [{
        trackName: candidate.title,
        artistName: candidate.artist,
        releaseDate: `${candidate.releaseYear}-01-01`,
        primaryGenreName: candidate.genre,
        kind: "song",
      }]
      : [];
    const expectedTitle = normalize(candidate.title);
    const expectedArtist = normalize(candidate.artist);
    const match = results.find((track) => {
      if (track.kind !== "song" || !track.trackName || !track.artistName) return false;
      const title = normalize(track.trackName);
      const artist = normalize(track.artistName);
      return (
        (title === expectedTitle || title.includes(expectedTitle) || expectedTitle.includes(title)) &&
        (artist.includes(expectedArtist) || expectedArtist.includes(artist)) &&
        !isAlternateVersion(track.trackName)
      );
    });
    if (!match?.trackName || !match.artistName || !match.releaseDate) {
      return rejected("título o artista sin metadatos verificables");
    }

    const releaseYear = new Date(match.releaseDate).getUTCFullYear();
    if (!Number.isFinite(releaseYear)) return rejected("fecha de lanzamiento inválida");
    if (constraints.releaseYear > 0 && releaseYear !== constraints.releaseYear) {
      return rejected(`año ${releaseYear}, se exigía ${constraints.releaseYear}`);
    }
    if (constraints.yearFrom && releaseYear < constraints.yearFrom) {
      return rejected(`año ${releaseYear}, anterior a ${constraints.yearFrom}`);
    }
    if (constraints.yearTo && releaseYear > constraints.yearTo) {
      return rejected(`año ${releaseYear}, posterior a ${constraints.yearTo}`);
    }
    if (!eraMatches(releaseYear, era)) {
      return rejected(`año ${releaseYear} fuera de la categoría ${era}`);
    }
    if (constraints.requiredArtist) {
      // "Solo X" significa artista principal exacto; las colaboraciones se rechazan.
      if (normalize(match.artistName) !== normalize(constraints.requiredArtist)) {
        return rejected(`artista principal ${match.artistName} no coincide`);
      }
    }
    if (
      constraints.allowedArtists?.length &&
      !constraints.allowedArtists.some(
        (artist) => normalize(match.artistName ?? "") === normalize(artist),
      )
    ) return rejected(`artista ${match.artistName} fuera del filtro`);
    const observedGenres = [candidate.genre, match.primaryGenreName ?? ""].filter(Boolean);
    if (
      constraints.requiredGenre &&
      !observedGenres.some((genre) => genreMatches(genre, constraints.requiredGenre))
    ) return rejected(`género ${observedGenres.join(" / ") || "desconocido"} no coincide`);
    if (
      constraints.allowedGenres?.length &&
      !constraints.allowedGenres.some((genre) =>
        observedGenres.some((actual) => genreMatches(actual, genre)),
      )
    ) return rejected(`género ${observedGenres.join(" / ") || "desconocido"} fuera del filtro`);
    if (
      constraints.languages?.length &&
      (!candidate.language ||
        !constraints.languages.includes(candidate.language as "es" | "en" | "international"))
    ) return rejected(`idioma ${candidate.language || "desconocido"} fuera del filtro`);

    return {
      track: {
        ...candidate,
        title: match.trackName,
        artist: match.artistName,
        releaseYear,
        genre: match.primaryGenreName ?? candidate.genre,
      },
    };
  } catch (error) {
    return rejected(
      error instanceof Error ? `error validando metadatos: ${error.message}` : "error validando metadatos",
    );
  }
}

export function cosineDetails(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) {
    return { similarity: 0, dot: 0, leftNorm: 0, rightNorm: 0 };
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  const leftNorm = Math.sqrt(leftMagnitude);
  const rightNorm = Math.sqrt(rightMagnitude);
  const denominator = leftNorm * rightNorm;
  return {
    similarity: denominator ? dot / denominator : 0,
    dot,
    leftNorm,
    rightNorm,
  };
}

export function calibrateSemanticSimilarity(similarity: number) {
  const midpoint = 0.72;
  const temperature = 0.03;
  return Math.max(
    0.01,
    1 / (1 + Math.exp(-(similarity - midpoint) / temperature)),
  );
}

type EmbeddingTaskType =
  | "SEMANTIC_SIMILARITY"
  | "RETRIEVAL_QUERY"
  | "RETRIEVAL_DOCUMENT"
  | "CLASSIFICATION"
  | "CLUSTERING";

interface EmbeddingInput {
  text: string;
  taskType: EmbeddingTaskType;
  title?: string;
}

export const MUSIC_EMBEDDING_MODEL = "gemini-embedding-001";
export const MUSIC_EMBEDDING_TASK = "CLASSIFICATION" as const;

export async function embedInputs(inputs: EmbeddingInput[]) {
  if (!env.GEMINI_API_KEY || !inputs.length) return null;
  const model = MUSIC_EMBEDDING_MODEL;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        requests: inputs.map(({ text, taskType, title }) => ({
          model: `models/${model}`,
          taskType,
          ...(title ? { title } : {}),
          outputDimensionality: 768,
          content: { parts: [{ text }] },
        })),
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 900);
    console.error(
      `[Embeddings] HTTP ${response.status}; se usará ranking textual. detalle=${detail}`,
    );
    return null;
  }
  const payload = (await response.json()) as {
    embeddings?: { values?: number[] }[];
  };
  const vectors = (payload.embeddings ?? []).map((embedding) => embedding.values ?? []);
  return vectors.length === inputs.length ? vectors : null;
}

export async function embedModelTexts(model: string, texts: string[]) {
  if (!env.GEMINI_API_KEY || !texts.length) return null;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          outputDimensionality: 768,
          content: { parts: [{ text }] },
        })),
      }),
    },
  );
  if (!response.ok) {
    console.error(`[Embeddings ${model}] HTTP ${response.status}.`);
    return null;
  }
  const payload = (await response.json()) as {
    embeddings?: { values?: number[] }[];
  };
  const vectors = (payload.embeddings ?? []).map((embedding) => embedding.values ?? []);
  return vectors.length === texts.length ? vectors : null;
}

export function embedTexts(texts: string[]) {
  return embedInputs(texts.map((text) => ({
    text,
    taskType: "SEMANTIC_SIMILARITY",
  })));
}

export function embedRetrieval(
  query: string,
  documents: Array<{ title: string; text: string }>,
) {
  return embedInputs([
    { text: query, taskType: "RETRIEVAL_QUERY" },
    ...documents.map((document) => ({
      text: document.text,
      title: document.title,
      taskType: "RETRIEVAL_DOCUMENT" as const,
    })),
  ]);
}

function difficultyAnchor(difficulty: RequestedDifficulty) {
  if (difficulty === "easy") {
    return "Canción extremadamente conocida, éxito emblemático, coro inmediato y fácil de adivinar para público general.";
  }
  if (difficulty === "hard") {
    return "Canción difícil de adivinar, éxito secundario o canción de álbum, conocida por fans pero no completamente desconocida.";
  }
  return "Canción de dificultad media, reconocible pero no obvia, sencillo secundario moderadamente popular.";
}

function targetDifficulty(difficulty: RequestedDifficulty) {
  if (difficulty === "easy") return 20;
  if (difficulty === "hard") return 80;
  return 50;
}

function shuffle<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export async function filterObjectiveCandidates(
  candidates: SongCandidate[],
  constraints: SongConstraints,
  era: string,
  excluded: string[],
) {
  const unique = candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (track) =>
          normalize(track.title) === normalize(candidate.title) &&
          normalize(track.artist) === normalize(candidate.artist),
      ) === index &&
      !excluded.some((track) => normalize(track) === normalize(`${candidate.title}|${candidate.artist}`)),
  );
  console.info(
    `[Música][Validación] ${unique.length} candidatas verificadas localmente contra ` +
    `los metadatos del catálogo SQL; iTunes no interviene en la playlist.`,
  );
  const validationResults = await Promise.all(
    unique.map(async (candidate) => ({
      candidate,
      result: await validateCandidate(candidate, constraints, era),
    })),
  );
  const validated = validationResults
    .map(({ result }) => result.track)
    .filter((track): track is SongCandidate => Boolean(track));
  const rejected = validationResults.filter(({ result }) => !result.track);
  console.info(`[Música][3/4] Validación objetiva: ${validated.length}/${unique.length} aprobadas.`);
  if (env.MUSIC_DEBUG) {
    validated.forEach((track) => console.info(
      `  ✓ [${track.source ?? "desconocida"}] ${track.title} — ${track.artist} | ` +
      `año=${track.releaseYear} género=${track.genre}`,
    ));
  }
  if (rejected.length) {
    const reasonCounts = rejected.reduce<Record<string, number>>((counts, { result }) => {
      const reason = result.reason ?? "motivo desconocido";
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {});
    console.info(
      `  Rechazadas: ${Object.entries(reasonCounts)
        .map(([reason, total]) => `${total}× ${reason}`)
        .join("; ")}`,
    );
    if (env.MUSIC_DEBUG) {
      rejected.forEach(({ candidate, result }) => console.info(
        `  ✗ [${candidate.source ?? "desconocida"}] ${candidate.title} — ${candidate.artist} | ` +
        `${result.reason ?? "motivo desconocido"}`,
      ));
    }
  }
  return validated;
}

export async function countObjectiveCandidates(
  candidates: SongCandidate[],
  constraints: SongConstraints,
  era: string,
  excluded: string[],
) {
  const unique = candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (track) =>
          normalize(track.title) === normalize(candidate.title) &&
          normalize(track.artist) === normalize(candidate.artist),
      ) === index &&
      !excluded.some((track) => normalize(track) === normalize(`${candidate.title}|${candidate.artist}`)),
  );
  const results = await Promise.all(
    unique.map((candidate) => validateCandidate(candidate, constraints, era)),
  );
  return results.filter((result) => Boolean(result.track)).length;
}

export async function validateRankAndSelect(
  candidates: SongCandidate[],
  constraints: SongConstraints,
  era: string,
  excluded: string[],
  count: number,
  objectiveAlreadyValidated = false,
  embeddingCache?: MusicCatalogRepository,
  embeddingOptions: EmbeddingSelectionOptions = {},
) {
  const validated = objectiveAlreadyValidated
    ? candidates
    : await filterObjectiveCandidates(candidates, constraints, era, excluded);

  const hasSubjective = Boolean(constraints.subjectiveRequest.trim());
  const subjectiveQuery = constraints.subjectiveRequest.trim();
  const hasDifficulty = constraints.difficulty !== "any";
  const promptKey = normalizeCatalogText(subjectiveQuery);
  const cachedPrompt = hasSubjective && embeddingCache
    ? await embeddingCache.findPromptEmbedding(
      promptKey, MUSIC_EMBEDDING_MODEL, MUSIC_EMBEDDING_TASK,
    )
    : undefined;
  const intentProfile = hasSubjective && !cachedPrompt
    ? await interpretMusicIntent(subjectiveQuery)
    : null;
  const semanticQuery = cachedPrompt?.semanticText ?? (intentProfile
    ? positiveIntentEmbeddingText(subjectiveQuery, intentProfile)
    : subjectiveQuery);
  const descriptions = validated.map(
    (track) =>
      `${track.title} de ${track.artist}. ${track.semanticDescription}. ` +
      `Género ${track.genre}, año ${track.releaseYear}.`,
  );
  const descriptionHashes = descriptions.map((text) =>
    createHash("sha256").update(text).digest("hex"));
  const keys = validated.map((track) => catalogKey(track.title, track.artist));
  const cachedEmbeddings = hasSubjective && embeddingCache
    ? await embeddingCache.findEmbeddings(
      keys, MUSIC_EMBEDDING_MODEL, MUSIC_EMBEDDING_TASK,
    )
    : new Map<string, { hash: string; vector: number[] }>();
  const documentVectors: Array<number[] | undefined> = validated.map((_, index) => {
    const cached = cachedEmbeddings.get(keys[index]);
    return cached?.hash === descriptionHashes[index] ? cached.vector : undefined;
  });
  const missingIndices = documentVectors.flatMap((vector, index) => vector ? [] : [index]);
  // Se preparan hasta tres candidatas por lugar solicitado. El caché permanente
  // evita recalcular las conocidas sin gastar 100 embeddings para sólo 10 rondas.
  const embeddingCandidateTarget = Math.max(
    count,
    Math.min(100, embeddingOptions.candidateTarget ?? count * 3),
  );
  const indicesToEmbed = missingIndices.slice(
    0, Math.max(0, embeddingCandidateTarget - documentVectors.filter(Boolean).length),
  );
  let queryVector = cachedPrompt?.vector;
  if (hasSubjective && !queryVector) {
    const promptVectors = await embedInputs([
      { text: semanticQuery, taskType: MUSIC_EMBEDDING_TASK },
    ]);
    queryVector = promptVectors?.[0];
    if (queryVector && embeddingCache) {
      await embeddingCache.savePromptEmbedding({
        key: promptKey,
        prompt: subjectiveQuery,
        semanticText: semanticQuery,
        model: MUSIC_EMBEDDING_MODEL,
        task: MUSIC_EMBEDDING_TASK,
        vector: queryVector,
      });
    }
  }
  const freshVectors = hasSubjective && queryVector && indicesToEmbed.length > 0
    ? await embedInputs(indicesToEmbed.map((index) => ({
        text: descriptions[index],
        taskType: MUSIC_EMBEDDING_TASK,
      })))
    : null;
  if (freshVectors && embeddingCache) {
    await Promise.all(indicesToEmbed.map(async (candidateIndex, vectorIndex) => {
      const vector = freshVectors[vectorIndex];
      if (!vector?.length) return;
      documentVectors[candidateIndex] = vector;
      const track = validated[candidateIndex];
      try {
        await embeddingCache.saveEmbedding({
          key: keys[candidateIndex],
          title: track.title,
          artist: track.artist,
          model: MUSIC_EMBEDDING_MODEL,
          task: MUSIC_EMBEDDING_TASK,
          hash: descriptionHashes[candidateIndex],
          vector,
        });
      } catch (error) {
        console.warn(
          `[Música][Embeddings caché] No se pudo guardar ${track.title} — ${track.artist}: ` +
          `${error instanceof Error ? error.message : String(error)}.`,
        );
      }
    }));
  } else if (freshVectors) {
    indicesToEmbed.forEach((candidateIndex, vectorIndex) => {
      documentVectors[candidateIndex] = freshVectors[vectorIndex];
    });
  }
  const embeddedCount = documentVectors.filter(Boolean).length;
  const songEmbeddingFallback = Boolean(
    hasSubjective && queryVector && indicesToEmbed.length && !freshVectors,
  );
  if (hasSubjective && embeddingOptions.requirePrompt && !queryVector) {
    throw Object.assign(new Error(
      "No hay cuota disponible para procesar el prompt. Quita el prompt y vuelve a confirmar.",
    ), { statusCode: 422, code: "MUSIC_PROMPT_QUOTA" });
  }
  if (
    songEmbeddingFallback && embeddingOptions.requirePrompt && embeddedCount < count
  ) {
    throw Object.assign(new Error(
      `No hay cuota y sólo ${embeddedCount} canciones tienen embedding; se necesitan ${count}. ` +
      "Quita el prompt y vuelve a confirmar.",
    ), { statusCode: 422, code: "MUSIC_PROMPT_QUOTA" });
  }
  // Un prompt no debe reducir una partida de 10 rondas al pequeño subconjunto
  // cuyo embedding ya está en caché. Si el caché no llena el paquete, se omite
  // el prompt y se conservan todas las candidatas objetivamente válidas.
  if (songEmbeddingFallback && embeddedCount < count) queryVector = undefined;
  const subjectiveActive = hasSubjective && Boolean(queryVector);
  console.info(
    `[Música][Embeddings] ${!hasSubjective ? "omitidos: no hay descripción subjetiva" :
      queryVector ? `activos: CLASSIFICATION (${embeddedCount}/${validated.length} canciones; ` +
        `cachéCanciones=${cachedEmbeddings.size}, nuevas=${freshVectors?.length ?? 0}, ` +
        `prompt=${cachedPrompt ? "caché" : "nuevo"})` :
        "NO QUEDA CUOTA PARA EL PROMPT: se quita el prompt y la ronda continúa " +
        "solo con Knownness de YouTube"}.`,
  );
  if (songEmbeddingFallback) console.warn(
    `[Música][Embeddings] Cuota agotada; ${embeddedCount >= count
      ? `se usarán exclusivamente las ${embeddedCount} candidatas con embedding persistido.`
      : `solo hay ${embeddedCount}/${count} embeddings existentes: se quita el prompt ` +
        "para completar todas las rondas."}`,
  );
  if (hasSubjective) {
    console.info(
      `[Música][Intención] fuente=${cachedPrompt ? "caché-prompt" : intentProfile?.source ?? "ninguna"}; ` +
      `métodoEmbedding=perfil-positivo; ` +
      `perfil=${JSON.stringify(intentProfile)}.`,
    );
    if (env.MUSIC_DEBUG) {
      console.info(`[Música][Intención] textoEmbedding=${JSON.stringify(semanticQuery)}.`);
    }
    console.info(
      `[Música][Embeddings] prompt=${JSON.stringify(subjectiveQuery)}; ` +
      `métrica=coseno CLASSIFICATION calibrado, escala 0.01..1 ` +
      `(más cerca de 1 = mayor ajuste relativo).`,
    );
  }
  const targetKnownness =
    constraints.difficulty === "easy" ? 85 :
      constraints.difficulty === "hard" ? 30 : 60;

  const embeddingRows = validated.map((track, index) => {
      const profile = documentVectors[index];
      const embedding = profile && queryVector
        ? cosineDetails(queryVector, profile)
        : { similarity: 0.5, dot: 0, leftNorm: 0, rightNorm: 0 };
      return { track, embedding, index };
    }).filter(({ index }) =>
      !hasSubjective || !queryVector || Boolean(documentVectors[index]));
  const ranked = embeddingRows
    .map(({ track, embedding }) => {
      const subjectiveSimilarity = queryVector
        ? documentVectors[validated.indexOf(track)]
          ? calibrateSemanticSimilarity(embedding.similarity)
          : 0.5
        : 0.5;
      const confidence = Math.max(0, Math.min(1, (track.knownnessConfidence ?? 0) / 100));
      const rawKnownness = track.knownnessScore ?? 50;
      const effectiveKnownness = rawKnownness * confidence + 50 * (1 - confidence);
      const knownness = effectiveKnownness / 100;
      const difficultyFit = hasDifficulty
        ? 1 - Math.min(1, Math.abs(effectiveKnownness - targetKnownness) / 70)
        : 0.5;
      const score = hasDifficulty && subjectiveActive
        ? difficultyFit * 0.70 + confidence * 0.15 + subjectiveSimilarity * 0.15
        : hasDifficulty
          ? difficultyFit * 0.85 + confidence * 0.15
          : subjectiveActive
            ? subjectiveSimilarity * 0.55 + knownness * 0.45
            : knownness;
      return {
        track, score, difficultyFit, subjectiveSimilarity,
        effectiveKnownness, rawKnownness, confidence, embedding,
      };
    })
    .sort((left, right) => right.score - left.score);

  console.info(
    `[Música][4/4] Ranking: popularidad=knownessScore propio; ` +
      `dificultad=${constraints.allowedDifficulties?.join(",") || constraints.difficulty}; ` +
      `subjetivo=${subjectiveActive ? "embedding" : "omitido"}.`,
  );
  if (env.MUSIC_DEBUG) ranked.filter(({ confidence }) => confidence > 0).forEach(({
    track, score, difficultyFit, subjectiveSimilarity,
    effectiveKnownness, rawKnownness, confidence,
  }, index) => {
    console.info(
      `  ${index + 1}. ${track.title} — ${track.artist} | final=${score.toFixed(4)} ` +
      `subjetivo=${subjectiveSimilarity.toFixed(4)} ` +
      `knowness=${rawKnownness.toFixed(1)} efectivo=${effectiveKnownness.toFixed(1)} ` +
      `confianza=${(confidence * 100).toFixed(1)}%`,
    );
  });
  if (env.MUSIC_DEBUG && queryVector) {
    ranked.forEach(({ track, embedding, subjectiveSimilarity }) => console.info(
      `[Música][Embedding detalle] ${track.title} — ${track.artist} | ` +
      `dot=${embedding.dot.toFixed(5)} normaPrompt=${embedding.leftNorm.toFixed(5)} ` +
      `normaCanción=${embedding.rightNorm.toFixed(5)} coseno=${embedding.similarity.toFixed(5)} ` +
      `similitudAjustada=${subjectiveSimilarity.toFixed(5)}`,
    ));
  }
  // Todas conservan una probabilidad positiva, pero la quinta potencia hace
  // que una coincidencia semántica fuerte sea muchísimo más probable.
  const RELATED_SEMANTIC_THRESHOLD = 0.20;
  const weightedPool = [...ranked];
  const selected: SongCandidate[] = [];
  while (selected.length < count && weightedPool.length) {
    const unusedTitles = weightedPool.filter(({ track }) =>
      !selected.some((selectedTrack) => normalize(selectedTrack.title) === normalize(track.title)));
    const titlePool = unusedTitles.length ? unusedTitles : weightedPool;
    const unusedArtists = titlePool.filter(({ track }) =>
      !selected.some((selectedTrack) => normalize(selectedTrack.artist) === normalize(track.artist)));
    const choices = unusedArtists.length ? unusedArtists : titlePool;
    const rawWeights = choices.map(({ score, subjectiveSimilarity, difficultyFit, confidence }) =>
      hasSubjective && queryVector
        ? (0.000001 + subjectiveSimilarity ** 5) *
          Math.exp(difficultyFit * 1.5 + confidence * 0.5)
        : Math.exp(score * 3));
    const related = choices.map(({ subjectiveSimilarity }) =>
      subjectiveSimilarity >= RELATED_SEMANTIC_THRESHOLD);
    const relatedTotal = rawWeights.reduce(
      (sum, weight, index) => sum + (related[index] ? weight : 0), 0,
    );
    const unrelatedTotal = rawWeights.reduce(
      (sum, weight, index) => sum + (!related[index] ? weight : 0), 0,
    );
    const weights = hasSubjective && queryVector && relatedTotal > 0 && unrelatedTotal > 0
      ? rawWeights.map((weight, index) => related[index]
        ? (weight / relatedTotal) * 0.98
        : (weight / unrelatedTotal) * 0.02)
      : rawWeights;
    let cursor = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    let picked = choices.length - 1;
    for (let index = 0; index < choices.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) {
        picked = index;
        break;
      }
    }
    const chosen = choices[picked];
    selected.push({
      ...chosen.track,
      subjectiveSimilarity: subjectiveActive ? chosen.subjectiveSimilarity : undefined,
      rankingScore: chosen.score,
    });
    weightedPool.splice(weightedPool.indexOf(chosen), 1);
  }
  console.info(
    `[Música][Preselección] ${selected.length} candidatas ponderadas; ` +
    `knownness pendiente cuando aún no existen vistas de YouTube.`,
  );
  if (env.MUSIC_DEBUG) selected.forEach((track, index) => {
    if ((track.knownnessConfidence ?? 0) <= 0) {
      console.info(
        `  Ronda ${index + 1}: [${track.source ?? "desconocida"}] ` +
        `${track.title} — ${track.artist} | knownness=pendiente de YouTube`,
      );
      return;
    }
    console.info(
      `  Ronda ${index + 1}: [${track.source ?? "desconocida"}] ` +
      `${track.title} — ${track.artist} | knowness=${track.knownnessScore?.toFixed(1) ?? "n/d"} ` +
      `confianza=${track.knownnessConfidence?.toFixed(1) ?? "n/d"}%`,
    );
  });
  return selected;
}
