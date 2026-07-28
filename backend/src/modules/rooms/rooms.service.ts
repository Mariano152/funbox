import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AvatarColor,
  AvatarKey,
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

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function roomError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export class RoomsService {
  constructor(private readonly repository: RoomsRepository) {}

  async createRoom() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");

      if (await this.repository.findByCode(code)) continue;

      const displayToken = randomBytes(24).toString("hex");
      const room = await this.repository.create(
        {
          id: randomUUID(),
          code,
          status: "lobby",
          players: [],
          createdAt: new Date().toISOString(),
        },
        hashToken(displayToken),
      );

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
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);

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

    if (room.players.length >= MAX_PLAYERS) throw roomError("La sala está llena", 409);

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
      isHost: room.players.length === 0,
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

  async startRoom(code: string, playerId: string, reconnectToken: string) {
    const room = await this.repository.findByCode(code);
    if (!room) throw roomError("Sala no encontrada", 404);
    if (room.status !== "lobby") throw roomError("La partida ya comenzó", 409);

    const leader = room.players.find((player) => player.id === playerId);
    if (!leader?.isHost) throw roomError("Solo el líder puede comenzar", 403);

    const authorized = await this.repository.isPlayerTokenValid(
      code,
      playerId,
      hashToken(reconnectToken),
    );
    if (!authorized) throw roomError("La sesión del líder no es válida", 401);

    const updatedRoom = await this.repository.updateStatus(code, "playing");
    if (!updatedRoom) throw roomError("Sala no encontrada", 404);
    return updatedRoom;
  }
}
