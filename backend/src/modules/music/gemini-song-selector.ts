import { env } from "../../config/env.js";
import type { SecretTrack } from "./music.types.js";
import {
  type RequestedDifficulty,
  type SongCandidate,
  type SongConstraints,
  validateRankAndSelect,
} from "./song-ranking.service.js";
import { getCurrentCatalogCandidates } from "./current-chart-catalog.js";

const TRACKS: Record<string, SecretTrack[]> = {
  "80s": [
    { title: "Take on Me", artist: "a-ha" },
    { title: "Billie Jean", artist: "Michael Jackson" },
    { title: "Livin' on a Prayer", artist: "Bon Jovi" },
    { title: "Sweet Child o' Mine", artist: "Guns N' Roses" },
    { title: "Like a Prayer", artist: "Madonna" },
  ],
  "90s": [
    { title: "I Want It That Way", artist: "Backstreet Boys" },
    { title: "No Scrubs", artist: "TLC" },
    { title: "Wannabe", artist: "Spice Girls" },
    { title: "Smells Like Teen Spirit", artist: "Nirvana" },
    { title: "Genie in a Bottle", artist: "Christina Aguilera" },
  ],
  "2000s": [
    { title: "Complicated", artist: "Avril Lavigne" },
    { title: "Crazy in Love", artist: "Beyoncé" },
    { title: "Umbrella", artist: "Rihanna" },
    { title: "Hips Don't Lie", artist: "Shakira" },
    { title: "Poker Face", artist: "Lady Gaga" },
  ],
  modern: [
    { title: "Shake It Off", artist: "Taylor Swift" },
    { title: "Blinding Lights", artist: "The Weeknd" },
    { title: "Levitating", artist: "Dua Lipa" },
    { title: "As It Was", artist: "Harry Styles" },
    { title: "Flowers", artist: "Miley Cyrus" },
  ],
  "current-hits": [
    { title: "Espresso", artist: "Sabrina Carpenter" },
    { title: "Beautiful Things", artist: "Benson Boone" },
    { title: "Birds of a Feather", artist: "Billie Eilish" },
    { title: "APT.", artist: "ROSÉ and Bruno Mars" },
    { title: "Die With a Smile", artist: "Lady Gaga and Bruno Mars" },
  ],
  all: [
    { title: "Rolling in the Deep", artist: "Adele" },
    { title: "Uptown Funk", artist: "Mark Ronson and Bruno Mars" },
    { title: "Despacito", artist: "Luis Fonsi" },
    { title: "Don't Stop Me Now", artist: "Queen" },
    { title: "Shape of You", artist: "Ed Sheeran" },
  ],
};

export interface SongPackSelection {
  tracks: SecretTrack[];
  source: "gemini" | "local";
  usage?: { prompt: number; output: number; thoughts: number; total: number };
  fallbackReason?: string;
  strictConstraints?: boolean;
}

export interface StructuredMusicFilters {
  genres: string[];
  languages: Array<"es" | "en" | "international">;
  yearFrom: number;
  yearTo: number;
  artists: string[];
  difficulty: RequestedDifficulty;
}

export function selectLocalSong(era: string, excluded: string[]): SecretTrack {
  const preferred = TRACKS[era] ?? TRACKS.all;
  const pool = [...preferred].filter(
    (track, index, tracks) =>
      tracks.findIndex(
        (candidate) => candidate.title === track.title && candidate.artist === track.artist,
      ) === index,
  );
  const available = pool.filter(
    (track) => !excluded.includes(`${track.title}|${track.artist}`),
  );
  const choices = available.length ? available : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

function selectLocalSongs(era: string, excluded: string[], count: number): SecretTrack[] {
  const selected: SecretTrack[] = [];
  const blocked = [...excluded];
  for (let index = 0; index < count; index += 1) {
    const track = selectLocalSong(era, blocked);
    selected.push(track);
    blocked.push(`${track.title}|${track.artist}`);
  }
  return selected;
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("candidates" in payload)) return "";
  const candidates = (payload as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  }).candidates;
  return candidates?.[0]?.content?.parts
    ?.map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .at(-1) ?? "";
}

function geminiErrorDetails(text: string) {
  try {
    const payload = JSON.parse(text) as {
      error?: {
        code?: number;
        status?: string;
        message?: string;
        details?: unknown[];
      };
    };
    if (!payload.error) return text.trim();
    return JSON.stringify({
      code: payload.error.code,
      status: payload.error.status,
      message: payload.error.message,
      details: payload.error.details,
    });
  } catch {
    return text.trim();
  }
}

function parseResponse(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  try {
    const parsed = JSON.parse(
      start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned,
    ) as {
      constraints?: Partial<SongConstraints>;
      songs?: Partial<SongCandidate>[];
    };
    const difficulty = ["any", "easy", "medium", "hard"].includes(
      String(parsed.constraints?.difficulty),
    )
      ? parsed.constraints?.difficulty as RequestedDifficulty
      : "any";
    const constraints: SongConstraints = {
      requiredArtist: String(parsed.constraints?.requiredArtist ?? "").trim(),
      releaseYear: Number(parsed.constraints?.releaseYear ?? 0),
      requiredGenre: String(parsed.constraints?.requiredGenre ?? "").trim(),
      difficulty,
      subjectiveRequest: String(parsed.constraints?.subjectiveRequest ?? "").trim(),
    };
    const songs = (parsed.songs ?? [])
      .filter((song) => song.title?.trim() && song.artist?.trim())
      .map((song): SongCandidate => ({
        source: "gemini",
        title: song.title!.trim(),
        artist: song.artist!.trim(),
        releaseYear: Number(song.releaseYear ?? 0),
        genre: String(song.genre ?? "").trim(),
        semanticDescription: String(song.semanticDescription ?? "").trim(),
        difficultyScore: Math.max(0, Math.min(100, Number(song.difficultyScore ?? 50))),
        language: String(song.language ?? "").trim().toLowerCase(),
      }));
    return { constraints, songs };
  } catch {
    return null;
  }
}

function enforceOnlyExplicitConstraints(
  constraints: SongConstraints,
  customPrompt: string,
): SongConstraints {
  const normalizedPrompt = customPrompt.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const yearMatch = normalizedPrompt.match(/\b(?:19|20)\d{2}\b/);
  const currentYearRequested = /\b(?:este ano|ano actual|del ano)\b/i.test(normalizedPrompt);
  const genreMatch = normalizedPrompt.match(
    /\b(pop|rock|reggaeton|regueton|electronica|electronic|country|rap|hip hop|r&b|salsa|cumbia|bachata|metal|indie|latin[oa]?)\b/i,
  );
  const difficulty = /\b(?:dificil(?:es)?|hard|experto)\b/i.test(normalizedPrompt)
    ? "hard"
    : /\b(?:facil(?:es)?|easy)\b/i.test(normalizedPrompt)
      ? "easy"
      : /\b(?:media|medio|medium|normal)\b/i.test(normalizedPrompt)
        ? "medium"
        : "any";
  const artistWasExplicit =
    /\b(?:solo|solamente|unicamente|puras?)\b/i.test(normalizedPrompt) ||
    /\bcanciones\s+de\b/i.test(normalizedPrompt);
  const requiredArtist = artistWasExplicit
    ? constraints.requiredArtist
      .replace(/^(?:solo|only|solamente|únicamente|unicamente)\s+/i, "")
      .trim()
    : "";

  return {
    ...constraints,
    requiredArtist,
    releaseYear: yearMatch
      ? Number(yearMatch[0])
      : currentYearRequested
        ? new Date().getUTCFullYear()
        : 0,
    requiredGenre: genreMatch?.[1] ?? "",
    difficulty,
  };
}

export async function selectSongPack(
  era: string,
  excluded: string[],
  count: number,
  customPrompt = "",
  filters?: StructuredMusicFilters,
): Promise<SongPackSelection> {
  const local = (reason: string): SongPackSelection => ({
    tracks: customPrompt || filters ? [] : selectLocalSongs(era, excluded, count),
    source: "local",
    fallbackReason: reason,
    strictConstraints: Boolean(customPrompt || filters),
  });
  const candidateCount = Math.max(15, count * 3);
  const currentDate = new Date().toISOString().slice(0, 10);
  const unavailableFallback = async (reason: string): Promise<SongPackSelection> => {
    if (filters) {
      const constraints: SongConstraints = {
        requiredArtist: "",
        releaseYear: 0,
        requiredGenre: "",
        allowedArtists: filters.artists,
        yearFrom: filters.yearFrom,
        yearTo: filters.yearTo,
        allowedGenres: filters.genres,
        languages: filters.languages,
        difficulty: filters.difficulty,
        subjectiveRequest: customPrompt.trim(),
      };
      const currentCandidates = await getCurrentCatalogCandidates(constraints, excluded);
      const currentTracks = await validateRankAndSelect(
        currentCandidates,
        constraints,
        era,
        excluded,
        count,
      );
      if (currentTracks.length) {
        return {
          tracks: currentTracks,
          source: "local",
          fallbackReason: `${reason}; catálogo actual verificado`,
          strictConstraints: true,
        };
      }

      const hasSpecificFilters =
        Boolean(customPrompt.trim()) ||
        filters.genres.length > 0 ||
        filters.languages.length > 0 ||
        filters.artists.length > 0;
      if (!hasSpecificFilters && era !== "current-hits") {
        return {
          tracks: selectLocalSongs(era, excluded, count),
          source: "local",
          fallbackReason: `${reason}; catálogo local de la categoría`,
          strictConstraints: true,
        };
      }
    }
    return local(reason);
  };
  if (!env.GEMINI_API_KEY) {
    return unavailableFallback("GEMINI_API_KEY no configurada");
  }
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
  );
  console.info(
    `[Gemini] Solicitando modelo=${env.GEMINI_MODEL}; ` +
    "herramientas=Google Search; salida=JSON estructurado.",
  );
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: [
            `Fecha actual: ${currentDate}. Propón ${candidateCount} canciones para una trivia musical.`,
            `Categoría base: ${era}.`,
            "Usa Google Search para comprobar lanzamientos recientes y no dependas solamente de tu memoria.",
            `Vibra subjetiva pedida por el anfitrión: ${customPrompt || "sin preferencia subjetiva"}.`,
            `Filtros objetivos obligatorios: géneros=${filters?.genres.join(", ") || "todos"}; ` +
              `idiomas=${filters?.languages.join(", ") || "todos"}; años=${filters?.yearFrom ?? 1900}-${filters?.yearTo ?? new Date().getUTCFullYear()}; ` +
              `artistas principales=${filters?.artists.join(", ") || "todos"}; dificultad=${filters?.difficulty ?? "any"}.`,
            "Antes de incluir cada canción, comprueba mediante fuentes actuales: título oficial, artista principal, año de lanzamiento original, género e idioma.",
            "Haz una revisión final canción por canción contra la categoría base y todos los filtros objetivos obligatorios.",
            "Descarta cualquier canción que falle una sola condición o cuyo dato no puedas verificar; no rellenes con resultados aproximados.",
            "El releaseYear debe ser el año del lanzamiento original de esa canción, no el año de un remaster, reedición, álbum recopilatorio o video.",
            `No repitas estas canciones: ${excluded.join(", ") || "ninguna"}.`,
            "Interpreta artista exclusivo, año exacto y género como restricciones objetivas obligatorias.",
            "Si dice solo un artista, requiredArtist debe ser ese artista principal exacto y no incluyas colaboraciones.",
            "Si pide fácil, media o difícil, clasifica difficulty y estima difficultyScore de 0 (muy fácil) a 100 (muy difícil).",
            "Para dificultad considera notoriedad relativa, si fue gran éxito, sencillo secundario o canción de álbum.",
            "Todo lo demás conviértelo en subjectiveRequest y describe semánticamente cada canción.",
            "No incluyas remixes, versiones en vivo, remasters, covers, acústicos ni duplicados.",
            `Semilla de variedad: ${crypto.randomUUID()}.`,
          ].join(" "),
        }],
      }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: Math.min(7000, Math.max(1800, candidateCount * 105)),
        thinkingConfig: { thinkingLevel: "minimal" },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            constraints: {
              type: "OBJECT",
              properties: {
                requiredArtist: { type: "STRING" },
                releaseYear: { type: "INTEGER" },
                requiredGenre: { type: "STRING" },
                difficulty: {
                  type: "STRING",
                  enum: ["any", "easy", "medium", "hard"],
                },
                subjectiveRequest: { type: "STRING" },
              },
              required: [
                "requiredArtist",
                "releaseYear",
                "requiredGenre",
                "difficulty",
                "subjectiveRequest",
              ],
            },
            songs: {
              type: "ARRAY",
              minItems: candidateCount,
              maxItems: candidateCount,
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  artist: { type: "STRING" },
                  releaseYear: { type: "INTEGER" },
                  genre: { type: "STRING" },
                  semanticDescription: { type: "STRING" },
                  difficultyScore: { type: "NUMBER" },
                  language: { type: "STRING", enum: ["es", "en", "other", "instrumental"] },
                },
                required: [
                  "title",
                  "artist",
                  "releaseYear",
                  "genre",
                  "semanticDescription",
                  "difficultyScore",
                  "language",
                ],
              },
            },
          },
          required: ["constraints", "songs"],
        },
      },
      }),
    });
  } catch (error) {
    console.error("[Gemini] No fue posible conectar con el servicio.", error);
    return unavailableFallback("Gemini no disponible");
  }

  if (!response.ok) {
    const details = geminiErrorDetails(await response.text());
    console.error(
      `[Gemini] modelo=${env.GEMINI_MODEL}; HTTP ${response.status}; ` +
      `catálogo de respaldo activado.${details ? ` ${details}` : ""}`,
    );
    return unavailableFallback(`Gemini HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    modelVersion?: string;
    candidates?: {
      groundingMetadata?: {
        webSearchQueries?: string[];
      };
    }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  console.info(
    `[Gemini] Modelo solicitado=${env.GEMINI_MODEL}; ` +
    `modelo reportado=${payload.modelVersion ?? "no informado por la API"}.`,
  );
  const searchQueries = payload.candidates?.[0]?.groundingMetadata?.webSearchQueries ?? [];
  if (searchQueries.length) {
    console.info(`[Música][BÚSQUEDA] Gemini consultó: ${searchQueries.join(" | ")}`);
  }
  const parsed = parseResponse(responseText(payload));
  if (!parsed?.songs.length) return local("Respuesta de Gemini no válida");

  console.info(`[Música][1/4] Gemini propuso ${parsed.songs.length} canciones:`);
  parsed.songs.forEach((song, index) => {
    console.info(
      `  ${index + 1}. ${song.title} — ${song.artist} | año=${song.releaseYear || "?"} ` +
      `género=${song.genre || "?"} dificultadIA=${song.difficultyScore}/100`,
    );
  });
  parsed.constraints = enforceOnlyExplicitConstraints(parsed.constraints, customPrompt);
  if (filters) {
    parsed.constraints = {
      ...parsed.constraints,
      requiredArtist: "",
      releaseYear: 0,
      requiredGenre: "",
      allowedArtists: filters.artists,
      yearFrom: filters.yearFrom,
      yearTo: filters.yearTo,
      allowedGenres: filters.genres,
      languages: filters.languages,
      difficulty: filters.difficulty,
      subjectiveRequest: customPrompt.trim(),
    };
  }
  console.info(
    `[Música][2/4] Restricciones: artista=${parsed.constraints.requiredArtist || "cualquiera"}, ` +
      `año=${parsed.constraints.releaseYear || "cualquiera"}, género=${parsed.constraints.requiredGenre || "cualquiera"}, ` +
      `dificultad=${parsed.constraints.difficulty}, subjetivo=${parsed.constraints.subjectiveRequest || "ninguno"}`,
  );
  if (filters) {
    console.info(
      `  Filtros estructurados: géneros=${filters.genres.join(", ") || "todos"}; ` +
      `idiomas=${filters.languages.join(", ") || "todos"}; años=${filters.yearFrom}-${filters.yearTo}; ` +
      `artistas=${filters.artists.join(", ") || "todos"}.`,
    );
  }
  const catalogCandidates = await getCurrentCatalogCandidates(
    parsed.constraints,
    excluded,
  );
  if (catalogCandidates.length) {
    console.info(
      `[Música][CATÁLOGO ACTUAL] Se agregaron ${catalogCandidates.length} canciones ` +
      `con fecha verificable de listas actuales.`,
    );
  }
  const tracks = await validateRankAndSelect(
    [...parsed.songs, ...catalogCandidates],
    parsed.constraints,
    era,
    excluded,
    count,
  );
  const usage = payload.usageMetadata;
  return {
    tracks,
    source: "gemini",
    strictConstraints: Boolean(
      customPrompt ||
      filters ||
      parsed.constraints.requiredArtist ||
      parsed.constraints.releaseYear ||
      parsed.constraints.requiredGenre,
    ),
    usage: usage
      ? {
          prompt: usage.promptTokenCount ?? 0,
          output: usage.candidatesTokenCount ?? 0,
          thoughts: usage.thoughtsTokenCount ?? 0,
          total: usage.totalTokenCount ?? 0,
        }
      : undefined,
  };
}
