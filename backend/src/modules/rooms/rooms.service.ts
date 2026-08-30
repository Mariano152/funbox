import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AvatarColor,
  AvatarKey,
  GameConfig,
  RoomsRepository,
  StoredPlayer,
} from "./rooms.repository.js";

const AVATARS: { key: AvatarKey; color: AvatarColor }[] = [
  { key: "nerd", color: "cyan" },
  { key: "athlete", color: "pink" },
  { key: "royal", color: "purple" },
  { key: "gardener", color: "lime" },
  { key: "rocker", color: "orange" },
  { key: "astronaut", color: "blue" },
  { key: "chef", color: "red" },
  { key: "detective", color: "yellow" },
  { key: "artist", color: "teal" },
];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_PLAYERS = 8;
const MAX_MUSIC_PARTICIPANTS = 9;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function roomError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export interface MusicLobbyPreparer {
  prepareLobbyPlaylist(code: string, config: GameConfig): Promise<void>;
  isLobbyPlaylistPrepared(code: string, config: GameConfig): Promise<boolean>;
  clearLobbyPlaylist(code: string): Promise<void>;
}
export interface TriviaLobbyPreparer extends MusicLobbyPreparer { onRoomStarted(code: string): Promise<void> }

export class RoomsService {
  constructor(
    private readonly repository: RoomsRepository,
    private readonly musicPreparer?: MusicLobbyPreparer,
    private readonly triviaPreparer?: TriviaLobbyPreparer,
  ) {}

  async createRoom(gameKey: string, gameConfig: GameConfig) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");

      if (await this.repository.findByCode(code)) continue;

      const displayToken = randomBytes(24).toString("hex");
      const roomInput = {
          id: randomUUID(),
          code,
          gameKey,
          gameConfig,
          status: "lobby" as const,
          players: [],
          createdAt: new Date().toISOString(),
        };
      if (gameKey === "guess-the-song") {
        if (!this.musicPreparer) throw roomError("El preparador musical no está disponible", 503);
        await this.musicPreparer.prepareLobbyPlaylist(code, gameConfig);
      }
      if (gameKey === "trivia") {
        if (!this.triviaPreparer) throw roomError("El generador de trivia no está disponible", 503);
        await this.triviaPreparer.prepareLobbyPlaylist(code, gameConfig);
      }
      let room;
      try {
        room = await this.repository.create(roomInput, hashToken(displayToken));
      } catch (error) {
        await this.musicPreparer?.clearLobbyPlaylist(code);
        await this.triviaPreparer?.clearLobbyPlaylist(code);
        throw error;
      }

      return { room };
    }

    throw roomError("No se pudo generar un código disponible", 503);
  }

  async findRoom(code: string) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    return room;
  }

  async joinRoom(code: string, nickname: string, reconnectToken?: string) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);

    const existingPlayer = await this.repository.findPlayerByNickname(code, nickname);
    if (existingPlayer) {
      if (!reconnectToken) throw roomError("Ese nametag ya está ocupado", 409);

      const reconnectedRoom = await this.repository.reconnectPlayer(
        code,
        nickname,
        hashToken(reconnectToken),
      );
      if (!reconnectedRoom) throw roomError("No se pudo recuperar ese jugador", 401);

      return {
        room: reconnectedRoom,
        player: existingPlayer,
        reconnectToken,
        reconnected: true,
      };
    }

    // A player who already belongs to the room may recover their session while
    // the game is running. Only brand-new players are blocked after the start.
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);

    const roomLimit = room.gameKey === "guess-the-song" ? MAX_MUSIC_PARTICIPANTS : MAX_PLAYERS;
    if (room.players.length >= roomLimit) throw roomError("La sala está llena", 409);

    const selectedAvatar = AVATARS.find(
      (avatar) => !room.players.some((player) => player.avatarKey === avatar.key),
    );
    if (!selectedAvatar) throw roomError("No hay personajes disponibles", 409);

    const token = randomBytes(32).toString("hex");
    const player: StoredPlayer = {
      id: randomUUID(),
      nickname,
      avatarKey: selectedAvatar.key,
      avatarColor: selectedAvatar.color,
      isHost: !room.players.some((candidate) => candidate.isHost),
      isDj: false,
      isConnected: true,
    };
    const updatedRoom = await this.repository.addPlayer(code, player, hashToken(token));
    if (!updatedRoom) throw roomError("La sala ya no está disponible", 404);

    return {
      room: updatedRoom,
      player,
      reconnectToken: token,
      reconnected: false,
    };
  }

  async changeAvatar(
    code: string,
    playerId: string,
    reconnectToken: string,
    avatarKey: AvatarKey,
  ) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);

    const authorized = await this.repository.isPlayerTokenValid(
      code,
      playerId,
      hashToken(reconnectToken),
    );
    if (!authorized) throw roomError("La sesión del jugador no es válida", 401);

    const avatar = AVATARS.find((candidate) => candidate.key === avatarKey);
    if (!avatar) throw roomError("Personaje no válido", 400);

    const occupied = room.players.some(
      (player) => player.avatarKey === avatarKey && player.id !== playerId,
    );
    if (occupied) throw roomError("Ese personaje ya está ocupado", 409);

    const updatedRoom = await this.repository.updateAvatar(
      code,
      playerId,
      avatar.key,
      avatar.color,
    );
    if (!updatedRoom) throw roomError("No pudimos cambiar el personaje", 409);
    return updatedRoom;
  }

  async changeDjRole(
    code: string,
    playerId: string,
    reconnectToken: string,
    isDj: boolean,
  ) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);
    if (room.gameKey !== "guess-the-song") {
      throw roomError("Este juego no necesita DJ", 409);
    }

    const authorized = await this.repository.isPlayerTokenValid(
      code,
      playerId,
      hashToken(reconnectToken),
    );
    if (!authorized) throw roomError("La sesión del jugador no es válida", 401);

    const currentDj = room.players.find((player) => player.isDj);
    if (isDj && currentDj && currentDj.id !== playerId) {
      throw roomError(`${currentDj.nickname} ya ocupa la cabina DJ`, 409);
    }
    if (!isDj && room.players.filter((player) => !player.isDj).length >= MAX_PLAYERS) {
      throw roomError("Los 8 lugares de jugadores ya están ocupados", 409);
    }

    let updatedRoom = await this.repository.updateDjRole(code, playerId, isDj);
    if (!updatedRoom) throw roomError("No pudimos actualizar el DJ", 409);

    if (isDj && playerId === room.players.find((player) => player.isHost)?.id) {
      const nextLeader = room.players.find(
        (player) => player.id !== playerId && !player.isDj,
      );
      updatedRoom = await this.repository.assignHost(code, nextLeader?.id);
    } else if (!isDj && !room.players.some((player) => player.isHost)) {
      updatedRoom = await this.repository.assignHost(code, playerId);
    }

    if (!updatedRoom) throw roomError("No pudimos transferir el liderazgo", 409);
    return updatedRoom;
  }

  async removePlayer(code: string, playerId: string) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    const removedPlayer = room.players.find((player) => player.id === playerId);
    if (!removedPlayer) throw roomError("Jugador no encontrado", 404);

    let updatedRoom = await this.repository.removePlayer(code, playerId);
    if (!updatedRoom) throw roomError("No pudimos sacar al jugador", 409);
    if (removedPlayer.isHost) {
      const nextLeader = updatedRoom.players.find((player) => !player.isDj);
      updatedRoom = await this.repository.assignHost(code, nextLeader?.id);
    }
    if (!updatedRoom) throw roomError("No pudimos actualizar el liderazgo", 409);
    return updatedRoom;
  }

  async startRoom(code: string, playerId: string, reconnectToken: string) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);

    const leader = room.players.find((player) => player.id === playerId);
    if (!leader?.isHost) throw roomError("Solo el líder puede comenzar", 403);
    if (leader.isDj) throw roomError("El DJ no puede dirigir la partida", 409);

    const authorized = await this.repository.isPlayerTokenValid(
      code,
      playerId,
      hashToken(reconnectToken),
    );
    if (!authorized) throw roomError("La sesión del líder no es válida", 401);

    if (room.gameKey === "guess-the-song" && !room.players.some((player) => player.isDj)) {
      throw roomError("Alguien debe entrar como DJ antes de comenzar", 409);
    }
    if (room.players.filter((player) => !player.isDj).length > MAX_PLAYERS) {
      throw roomError("Debe haber máximo 8 jugadores además del DJ", 409);
    }
    if (
      room.gameKey === "guess-the-song" &&
      !await this.musicPreparer?.isLobbyPlaylistPrepared(code, room.gameConfig)
    ) {
      throw roomError(
        "La música todavía no está preparada. Confirma la configuración antes de comenzar.",
        409,
      );
    }
    if (room.gameKey === "trivia" && !await this.triviaPreparer?.isLobbyPlaylistPrepared(code, room.gameConfig)) {
      throw roomError("La trivia todavía no está preparada", 409);
    }

    const updatedRoom = await this.repository.updateStatus(code, "playing");
    if (!updatedRoom) throw roomError("Sala no encontrada", 404);
    if (room.gameKey === "trivia") await this.triviaPreparer?.onRoomStarted(code);
    return updatedRoom;
  }

  async updateMusicConfig(code: string, gameConfig: GameConfig) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby") throw roomError("La configuración ya está bloqueada", 409);
    if (room.gameKey !== "guess-the-song") throw roomError("Esta sala no es musical", 409);
    if (!this.musicPreparer) throw roomError("El preparador musical no está disponible", 503);
    await this.musicPreparer.prepareLobbyPlaylist(code, gameConfig);
    const updated = await this.repository.updateGameConfig(code, gameConfig);
    if (!updated) throw roomError("No pudimos guardar la configuración", 409);
    return updated;
  }

  async updateTriviaConfig(code: string, gameConfig: GameConfig) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby" || room.gameKey !== "trivia") throw roomError("La configuración ya está bloqueada", 409);
    if (!this.triviaPreparer) throw roomError("El generador de trivia no está disponible", 503);
    await this.triviaPreparer.prepareLobbyPlaylist(code, gameConfig);
    const updated = await this.repository.updateGameConfig(code, gameConfig);
    if (!updated) throw roomError("No pudimos guardar la configuración", 409);
    return updated;
  }
}
