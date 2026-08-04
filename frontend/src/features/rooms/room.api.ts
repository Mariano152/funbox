import type { AvatarKey, PlayerSession, Room } from "./room.types";

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
  throw new Error(
    "Falta NEXT_PUBLIC_API_URL. Configura en Vercel la URL pública del backend de Render.",
  );
}

export const API_URL = (configuredApiUrl || "http://localhost:4000").replace(/\/+$/, "");

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    // El estado de una sala cambia en tiempo real; una respuesta cacheada
    // puede dejar a un jugador en la partida anterior después de "Volver a jugar".
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "No pudimos completar la acción");
  return body as T;
}

export function createRoom(gameKey: string, gameConfig: object = {}) {
  return apiRequest<{ room: Room }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ gameKey, gameConfig }),
  });
}

export function getRoom(code: string) {
  return apiRequest<Room>(`/api/rooms/${code}`);
}

export function joinRoom(code: string, nickname: string, reconnectToken?: string) {
  return apiRequest<{
    room: Room;
    player: Room["players"][number];
    reconnectToken: string;
    reconnected: boolean;
  }>(`/api/rooms/${code}/players`, {
    method: "POST",
    body: JSON.stringify({ nickname, reconnectToken }),
  });
}

export function startRoom(session: PlayerSession) {
  return apiRequest<Room>(`/api/rooms/${session.code}/start`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
    }),
  });
}

export function changeAvatar(session: PlayerSession, avatarKey: AvatarKey) {
  return apiRequest<Room>(`/api/rooms/${session.code}/players/avatar`, {
    method: "PATCH",
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
      avatarKey,
    }),
  });
}

export function changeDjRole(session: PlayerSession, isDj: boolean) {
  return apiRequest<Room>(`/api/rooms/${session.code}/players/dj`, {
    method: "PATCH",
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
      isDj,
    }),
  });
}

export function removeRoomPlayer(code: string, playerId: string) {
  return apiRequest<Room>(`/api/rooms/${code}/players/${playerId}`, { method: "DELETE" });
}

export function updateMusicConfig(code: string, gameConfig: object) {
  return apiRequest<Room>(`/api/rooms/${code}/music-config`, {
    method: "PATCH",
    body: JSON.stringify(gameConfig),
  });
}

export function sessionKey(code: string, nickname: string) {
  return `funbox:player:${code.toUpperCase()}:${nickname.trim().toLowerCase()}`;
}
