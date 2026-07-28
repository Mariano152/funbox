export type AvatarKey =
  | "nerd"
  | "athlete"
  | "royal"
  | "gardener"
  | "rocker"
  | "astronaut"
  | "chef"
  | "detective"
  | "artist";

export type AvatarColor =
  | "cyan"
  | "pink"
  | "purple"
  | "lime"
  | "orange"
  | "blue"
  | "red"
  | "yellow"
  | "teal";

export interface StoredPlayer {
  id: string;
  nickname: string;
  avatarKey: AvatarKey;
  avatarColor: AvatarColor;
  isHost: boolean;
  isConnected: boolean;
}

export interface StoredRoom {
  id: string;
  code: string;
  status: "lobby" | "playing" | "finished";
  players: StoredPlayer[];
  createdAt: string;
}

export interface RoomsRepository {
  create(room: StoredRoom, hostTokenHash: string): Promise<StoredRoom>;
  findByCode(code: string): Promise<StoredRoom | null>;
  findPlayerByNickname(code: string, nickname: string): Promise<StoredPlayer | null>;
  addPlayer(code: string, player: StoredPlayer, reconnectTokenHash: string): Promise<StoredRoom | null>;
  reconnectPlayer(code: string, nickname: string, reconnectTokenHash: string): Promise<StoredRoom | null>;
  isPlayerTokenValid(code: string, playerId: string, reconnectTokenHash: string): Promise<boolean>;
  updateAvatar(code: string, playerId: string, avatarKey: AvatarKey, avatarColor: AvatarColor): Promise<StoredRoom | null>;
  updateStatus(code: string, status: StoredRoom["status"]): Promise<StoredRoom | null>;
}
