import { createHash, randomBytes } from "node:crypto";
import type { GameConfig, RoomsRepository } from "../rooms/rooms.repository.js";
import { publishRoomUpdated } from "../rooms/rooms.events.js";
import { publishMusicUpdated } from "./music.events.js";
import type { MusicHistoryRepository } from "./music-history.repository.js";
import type { MusicStateRepository } from "./music-state.repository.js";
import { selectCatalogSongPack } from "./catalog-song-selector.js";
import { catalogKey } from "./catalog-utils.js";
import type { MusicCatalogRepository } from "./music-catalog.repository.js";
import type { MusicPublicState, MusicRoomState, PreparedMusicTrack } from "./music.types.js";
import { findYouTubeVideo, getYouTubeVideoDetails, randomInterval } from "./youtube.service.js";

const states = new Map<string, MusicRoomState>();

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function musicError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

function stableConfigKey(config: GameConfig) {
  return JSON.stringify(Object.fromEntries(Object.entries(config).sort(([left], [right]) =>
    left.localeCompare(right))));
}

function catalogFilters(config: GameConfig) {
  return {
    genres: Array.isArray(config.genres) ? config.genres : [],
    languages: Array.isArray(config.languages)
      ? config.languages.filter(
        (language): language is "es" | "en" | "international" =>
          ["es", "en", "international"].includes(String(language)),
      )
      : ["es", "en", "international"].includes(String(config.language))
        ? [config.language as "es" | "en" | "international"]
        : [],
    yearFrom: Number(config.yearFrom ?? 1980),
    yearTo: Number(config.yearTo ?? new Date().getUTCFullYear()),
    artists: Array.isArray(config.artists) ? config.artists : [],
    difficulties: Array.isArray(config.difficulties)
      ? config.difficulties.filter(
        (difficulty): difficulty is "easy" | "medium" | "hard" =>
          ["easy", "medium", "hard"].includes(String(difficulty)),
      )
      : [],
    difficulty: ["any", "easy", "medium", "hard"].includes(String(config.difficulty))
      ? config.difficulty as "any" | "easy" | "medium" | "hard"
      : "any" as const,
  };
}

function normalizeAnswer(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\[(][^\])]*(?:remaster|live|version|feat|featuring|ft|with|w\/)[^\])]*[\])]/g, "")
    .replace(/\b(?:feat|featuring|ft|with|w\/)\b.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function matchesAnswer(candidate: string, expected: string) {
  const normalizedCandidate = normalizeAnswer(candidate);
  const normalizedExpected = normalizeAnswer(expected);
  if (!normalizedCandidate) return false;
  if (normalizedCandidate === normalizedExpected) return true;
  const tolerance = normalizedExpected.length >= 12 ? 2 : 1;
  return editDistance(normalizedCandidate, normalizedExpected) <= tolerance;
}

function artistNames(value: string) {
  return value
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+/gi, ",")
    .split(/\s*(?:,|&|\bx\b|\band\b)\s*/i)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function matchesArtist(candidate: string, expected: string) {
  return artistNames(expected).some((artist) => matchesAnswer(candidate, artist));
}

function applyAnswer(
  state: MusicRoomState,
  playerId: string,
  song: string,
  artist: string,
) {
  if (!state.secretTrack) throw musicError("No hay una canción para calificar", 409);
  const previous = state.publicState.answerResults?.[playerId] ?? {
    songCorrect: false,
    artistCorrect: false,
    submitted: false,
  };
  const songCorrect = previous.songCorrect || matchesAnswer(song, state.secretTrack.title);
  const artistCorrect = previous.artistCorrect || matchesArtist(artist, state.secretTrack.artist);
  const gained =
    Number(songCorrect && !previous.songCorrect) +
    Number(artistCorrect && !previous.artistCorrect);
  const result = { songCorrect, artistCorrect, submitted: true };
  const score = (state.publicState.scores?.[playerId] ?? 0) + gained;
  state.publicState = {
    ...state.publicState,
    answerResults: { ...state.publicState.answerResults, [playerId]: result },
    scores: { ...state.publicState.scores, [playerId]: score },
  };
  return { result, score };
}

export class MusicService {
  constructor(
    private readonly rooms: RoomsRepository,
    private readonly history: MusicHistoryRepository,
    private readonly catalog: MusicCatalogRepository,
    private readonly stateRepository: MusicStateRepository,
  ) {}

  private async loadState(code: string) {
    const cached = states.get(code);
    if (cached) return cached;
    const persisted = await this.stateRepository.find(code);
    if (persisted) states.set(code, persisted);
    return persisted;
  }

  private async saveState(code: string, state: MusicRoomState) {
    states.set(code, state);
    await this.stateRepository.save(code, state);
  }

  async prepareLobbyPlaylist(code: string, config: GameConfig) {
    const rounds = Math.max(1, Math.min(20, Number(config.rounds ?? 10)));
    const prompt = String(config.prompt ?? "").trim();
    const era = String(config.era ?? "all");
    const recentTracks = await this.history.findRecent();
    const excluded = recentTracks.map((track) => `${track.title}|${track.artist}`).slice(0, 24);
    const backupTracks = 3;
    const selection = await selectCatalogSongPack(
      era,
      excluded,
      rounds + backupTracks,
      prompt,
      catalogFilters(config),
      this.catalog,
      { candidateTarget: rounds * 5, requirePrompt: Boolean(prompt) },
    );
    if (selection.tracks.length < rounds) {
      throw musicError(
        `Solo ${selection.tracks.length} canciones cumplieron todas las condiciones; ` +
        `se necesitan ${rounds}. Ajusta los filtros o reduce las rondas.`,
        422,
      );
    }

    const preparedTracks = await Promise.all(selection.tracks.map(async (track) => {
      const video = await findYouTubeVideo(track.title, track.artist, {
        cachedVideoId: track.youtubeVideoId,
        recordingMbid: track.recordingMbid,
      });
      await this.catalog.saveYouTube(
        catalogKey(track.title, track.artist), track.title, track.artist, video,
      );
      return {
        ...track,
        preparedVideoId: video.videoId,
        preparedDurationSeconds: video.durationSeconds,
      } satisfies PreparedMusicTrack;
    }));

    const current = await this.loadState(code);
    const publicState: MusicPublicState = {
      djConnected: current?.publicState.djConnected ?? false,
      phase: current?.publicState.djConnected ? "ready" : "waiting_for_dj",
      roundNumber: 0,
      totalRounds: rounds,
      clipDuration: Number(config.clipDuration ?? 20),
      answerDuration: Number(config.answerDuration ?? 30),
      answerResults: {},
      scores: current?.publicState.scores ?? {},
    };
    await this.saveState(code, {
      publicState,
      djTokenHash: current?.djTokenHash,
      queuedTracks: preparedTracks,
      preparedConfigKey: stableConfigKey(config),
      answerDrafts: {},
      usedTracks: [],
    });
    publishMusicUpdated(code, publicState);
    console.info(
      `[Música ${code}] Configuración confirmada: ${rounds} canciones precargadas; ` +
      `pool semántico objetivo=${prompt ? 70 : 0}.`,
    );
  }

  async isLobbyPlaylistPrepared(code: string, config: GameConfig) {
    const state = await this.loadState(code);
    return Boolean(
      state?.preparedConfigKey === stableConfigKey(config) &&
      state.queuedTracks && state.queuedTracks.length >= Number(config.rounds ?? 10),
    );
  }

  async clearLobbyPlaylist(code: string) {
    states.delete(code);
    await this.stateRepository.delete(code);
  }

  async connectDj(code: string, playerId: string, reconnectToken: string) {
    const room = await this.requireMusicRoom(code);
    const authorized = await this.rooms.isPlayerTokenValid(
      code,
      playerId,
      hashToken(reconnectToken),
    );
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!authorized || !player?.isDj) {
      throw musicError("Primero debes elegir el rol DJ desde tu sala", 403);
    }
    const token = randomBytes(32).toString("hex");
    const current = await this.loadState(code);
    const publicState: MusicPublicState = {
      djConnected: true,
      phase: current?.publicState.phase === "waiting_for_dj"
        ? "ready"
        : current?.publicState.phase ?? "ready",
      roundNumber: current?.publicState.roundNumber ?? 0,
      totalRounds: Number(room.gameConfig.rounds ?? 10),
      clipDuration: Number(room.gameConfig.clipDuration ?? 20),
      answerDuration: Number(room.gameConfig.answerDuration ?? 30),
      answerResults: current?.publicState.answerResults ?? {},
      scores: current?.publicState.scores ?? {},
    };
    await this.saveState(code, {
      publicState,
      djTokenHash: hashToken(token),
      usedTracks: current?.usedTracks ?? [],
      queuedTracks: current?.queuedTracks ?? [],
      preparedConfigKey: current?.preparedConfigKey,
      answerDrafts: current?.answerDrafts ?? {},
      secretTrack: current?.secretTrack,
    });
    publishMusicUpdated(code, publicState);
    return { djToken: token, state: publicState };
  }

  async getState(code: string) {
    const room = await this.requireMusicRoom(code);
    return (await this.loadState(code))?.publicState ?? {
      djConnected: false,
      phase: "waiting_for_dj",
      roundNumber: 0,
      totalRounds: Number(room.gameConfig.rounds ?? 10),
      clipDuration: Number(room.gameConfig.clipDuration ?? 20),
      answerDuration: Number(room.gameConfig.answerDuration ?? 30),
    } satisfies MusicPublicState;
  }

  async prepareRound(code: string, token: string) {
    const room = await this.requireMusicRoom(code);
    if (room.status !== "playing") throw musicError("La partida todavía no ha comenzado", 409);
    const state = await this.requireDj(code, token);
    if (state.publicState.roundNumber >= state.publicState.totalRounds) {
      throw musicError("La partida ya completó todas sus rondas", 409);
    }

    state.publicState = {
      ...state.publicState,
      phase: "loading",
      error: undefined,
      revealedTrack: undefined,
      videoId: undefined,
      deadlineAt: undefined,
      answerResults: {},
    };
    state.answerDrafts = {};
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);

    try {
      const era = String(room.gameConfig.era ?? "all");
      const track = state.queuedTracks?.shift();
      if (!track) {
        throw musicError(
          "La playlist no está preparada. Vuelve al lobby y confirma la configuración.",
          409,
        );
      }
      console.info(
        `[Música ${code}] Ronda ${state.publicState.roundNumber + 1}: ${track.title} — ${track.artist}`,
      );
      const video = track.preparedVideoId && track.preparedDurationSeconds
        ? { videoId: track.preparedVideoId, durationSeconds: track.preparedDurationSeconds, embeddable: true }
        : await findYouTubeVideo(track.title, track.artist, {
          cachedVideoId: track.youtubeVideoId,
          recordingMbid: track.recordingMbid,
        });
      const interval = randomInterval(video.durationSeconds, state.publicState.clipDuration);
      state.secretTrack = track;
      state.usedTracks.push(`${track.title}|${track.artist}`);
      await this.history.add(room.id, era, track);
      state.publicState = {
        ...state.publicState,
        phase: "ready",
        roundNumber: state.publicState.roundNumber + 1,
        videoId: video.videoId,
        ...interval,
      };
      await this.saveState(code, state);
      publishMusicUpdated(code, state.publicState);
      return state.publicState;
    } catch (reason) {
      state.publicState = {
        ...state.publicState,
        phase: "error",
        error: reason instanceof Error ? reason.message : "No pudimos preparar la canción",
      };
      await this.saveState(code, state);
      publishMusicUpdated(code, state.publicState);
      throw reason;
    }
  }

  async replaceRoundTrack(code: string, token: string) {
    const room = await this.requireMusicRoom(code);
    if (room.status !== "playing") throw musicError("La partida todavía no ha comenzado", 409);
    const state = await this.requireDj(code, token);
    if (state.publicState.phase !== "ready" || !state.secretTrack) {
      throw musicError("La canción sólo puede reemplazarse antes de comenzar", 409);
    }
    const failedTrack = state.secretTrack;
    const replacement = state.queuedTracks?.shift();
    if (!replacement) {
      throw musicError("No quedan canciones de reserva para esta partida", 409);
    }
    const video = replacement.preparedVideoId && replacement.preparedDurationSeconds
      ? {
        videoId: replacement.preparedVideoId,
        durationSeconds: replacement.preparedDurationSeconds,
      }
      : await findYouTubeVideo(replacement.title, replacement.artist, {
        cachedVideoId: replacement.youtubeVideoId,
        recordingMbid: replacement.recordingMbid,
      });
    const interval = randomInterval(video.durationSeconds, state.publicState.clipDuration);
    state.secretTrack = replacement;
    state.usedTracks.push(`${replacement.title}|${replacement.artist}`);
    state.answerDrafts = {};
    state.publicState = {
      ...state.publicState,
      phase: "ready",
      error: undefined,
      revealedTrack: undefined,
      answerResults: {},
      deadlineAt: undefined,
      videoId: video.videoId,
      ...interval,
    };
    await this.history.add(room.id, String(room.gameConfig.era ?? "all"), replacement);
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    console.warn(
      `[Música ${code}] Video reemplazado sin consumir ronda: ` +
      `${failedTrack.title} — ${failedTrack.artist} -> ${replacement.title} — ${replacement.artist}.`,
    );
    return state.publicState;
  }

  async submitAnswer(
    code: string,
    input: { playerId: string; reconnectToken: string; song: string; artist: string },
  ) {
    const room = await this.requireMusicRoom(code);
    if (room.status !== "playing") throw musicError("La partida todavía no ha comenzado", 409);
    const authorized = await this.rooms.isPlayerTokenValid(
      code,
      input.playerId,
      hashToken(input.reconnectToken),
    );
    const player = room.players.find((candidate) => candidate.id === input.playerId);
    if (!authorized || !player) throw musicError("La sesión del jugador no es válida", 401);
    if (player.isDj) throw musicError("El DJ no participa en las respuestas", 403);

    const state = await this.loadState(code);
    const acceptingLateReveal =
      state?.publicState.phase === "reveal" &&
      Boolean(state.publicState.deadlineAt) &&
      new Date(state.publicState.deadlineAt ?? 0).getTime() >= Date.now();
    if (
      !state?.secretTrack ||
      (!["playing", "answering"].includes(state.publicState.phase) && !acceptingLateReveal)
    ) {
      throw musicError("Ahora mismo no hay una canción para responder", 409);
    }

    const { result, score } = applyAnswer(
      state,
      input.playerId,
      input.song,
      input.artist,
    );
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return { result, score, state: state.publicState };
  }

  async saveAnswerDraft(
    code: string,
    input: {
      playerId: string;
      reconnectToken: string;
      roundNumber: number;
      song: string;
      artist: string;
    },
  ) {
    const room = await this.requireMusicRoom(code);
    const authorized = await this.rooms.isPlayerTokenValid(
      code,
      input.playerId,
      hashToken(input.reconnectToken),
    );
    const player = room.players.find((candidate) => candidate.id === input.playerId);
    if (!authorized || !player) throw musicError("La sesión del jugador no es válida", 401);
    if (player.isDj) throw musicError("El DJ no participa en las respuestas", 403);
    const state = await this.loadState(code);
    if (!state?.secretTrack || input.roundNumber !== state.publicState.roundNumber) {
      throw musicError("Ese borrador pertenece a otra ronda", 409);
    }
    const acceptingLateReveal =
      state.publicState.phase === "reveal" &&
      Boolean(state.publicState.deadlineAt) &&
      new Date(state.publicState.deadlineAt ?? 0).getTime() >= Date.now();
    const acceptingDraft =
      state.publicState.phase === "playing" ||
      state.publicState.phase === "answering" ||
      acceptingLateReveal ||
      (state.publicState.phase === "paused" &&
        ["playing", "answering"].includes(state.publicState.pausedPhase ?? ""));
    if (!acceptingDraft) throw musicError("Ahora mismo no se aceptan borradores", 409);
    state.answerDrafts = {
      ...state.answerDrafts,
      [input.playerId]: {
        roundNumber: input.roundNumber,
        song: input.song,
        artist: input.artist,
      },
    };
    if (acceptingLateReveal && (input.song.trim() || input.artist.trim())) {
      applyAnswer(state, input.playerId, input.song, input.artist);
      publishMusicUpdated(code, state.publicState);
    }
    await this.saveState(code, state);
    return { saved: true };
  }

  async markStarted(code: string, token: string) {
    const state = await this.requireDj(code, token);
    if (state.publicState.phase !== "ready") throw musicError("La ronda no está lista", 409);
    state.publicState = {
      ...state.publicState,
      phase: "playing",
      deadlineAt: new Date(Date.now() + state.publicState.clipDuration * 1000).toISOString(),
    };
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return state.publicState;
  }

  async finishClip(code: string, token: string) {
    const state = await this.requireDj(code, token);
    if (state.publicState.phase !== "playing") {
      throw musicError("El fragmento no está reproduciéndose", 409);
    }
    state.publicState = {
      ...state.publicState,
      phase: "answering",
      deadlineAt: new Date(
        Date.now() + state.publicState.answerDuration * 1000,
      ).toISOString(),
    };
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return state.publicState;
  }

  async setPaused(code: string, paused: boolean) {
    const state = await this.loadState(code);
    if (!state) throw musicError("La partida musical todavía no está lista", 409);
    if (paused) {
      if (!["playing", "answering"].includes(state.publicState.phase)) {
        throw musicError("Solo puedes pausar una ronda activa", 409);
      }
      const activePhase = state.publicState.phase as "playing" | "answering";
      const remainingMs = state.publicState.deadlineAt
        ? Math.max(0, new Date(state.publicState.deadlineAt).getTime() - Date.now())
        : 0;
      state.publicState = {
        ...state.publicState,
        phase: "paused",
        pausedPhase: activePhase,
        pausedRemainingMs: remainingMs,
        deadlineAt: undefined,
      };
    } else {
      if (state.publicState.phase !== "paused" || !state.publicState.pausedPhase) {
        throw musicError("La partida no está pausada", 409);
      }
      state.publicState = {
        ...state.publicState,
        phase: state.publicState.pausedPhase,
        deadlineAt: new Date(
          Date.now() + (state.publicState.pausedRemainingMs ?? 0),
        ).toISOString(),
        pausedPhase: undefined,
        pausedRemainingMs: undefined,
      };
    }
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return state.publicState;
  }

  async prepareManual(
    code: string,
    token: string,
    input: { title: string; artist: string; youtubeUrl: string },
  ) {
    const room = await this.requireMusicRoom(code);
    if (room.status !== "playing") throw musicError("La partida todavía no ha comenzado", 409);
    const state = await this.requireDj(code, token);
    const url = new URL(input.youtubeUrl);
    const videoId = url.hostname.includes("youtu.be")
      ? url.pathname.slice(1)
      : url.searchParams.get("v");
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) throw musicError("Enlace de YouTube no válido", 400);
    const video = await getYouTubeVideoDetails(videoId);
    const interval = randomInterval(video.durationSeconds, state.publicState.clipDuration);
    state.secretTrack = { title: input.title, artist: input.artist };
    state.usedTracks.push(`${input.title}|${input.artist}`);
    state.answerDrafts = {};
    state.publicState = {
      ...state.publicState,
      phase: "ready",
      error: undefined,
      revealedTrack: undefined,
      answerResults: {},
      roundNumber: state.publicState.roundNumber + 1,
      videoId,
      ...interval,
    };
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return state.publicState;
  }

  async reveal(code: string, token: string) {
    const state = await this.requireDj(code, token);
    if (!state.secretTrack) throw musicError("No hay canción que revelar", 409);
    if (
      state.publicState.phase === "reveal" &&
      state.publicState.roundNumber >= state.publicState.totalRounds
    ) {
      state.publicState = {
        ...state.publicState,
        phase: "finished",
        deadlineAt: undefined,
      };
      await this.saveState(code, state);
      publishMusicUpdated(code, state.publicState);
      return state.publicState;
    }
    for (const [playerId, draft] of Object.entries(state.answerDrafts ?? {})) {
      if (
        draft.roundNumber === state.publicState.roundNumber &&
        (draft.song.trim() || draft.artist.trim())
      ) {
        applyAnswer(state, playerId, draft.song, draft.artist);
      }
    }
    state.publicState = {
      ...state.publicState,
      phase: "reveal",
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      revealedTrack: state.secretTrack,
    };
    await this.saveState(code, state);
    publishMusicUpdated(code, state.publicState);
    return state.publicState;
  }

  async returnToLobby(code: string) {
    await this.requireMusicRoom(code);
    const room = await this.rooms.updateStatus(code, "lobby");
    if (!room) throw musicError("Sala no encontrada", 404);
    publishRoomUpdated(room);
    const previousState = await this.loadState(code);
    if (previousState) previousState.publicState.scores = {};
    await this.prepareLobbyPlaylist(code, room.gameConfig);
    return room;
  }

  private async requireMusicRoom(code: string) {
    const room = await this.rooms.findByCode(code);
    if (!room) throw musicError("Sala no encontrada", 404);
    if (room.gameKey !== "guess-the-song") throw musicError("Esta sala no es musical", 409);
    return room;
  }

  private async requireDj(code: string, token: string) {
    const state = await this.loadState(code);
    if (!state?.djTokenHash || state.djTokenHash !== hashToken(token)) {
      throw musicError("El dispositivo DJ no está autorizado", 401);
    }
    return state;
  }
}
