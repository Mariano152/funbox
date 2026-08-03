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

export type GameConfig = Record<string, string | number | boolean | null | string[]>;

export interface StoredPlayer {
  id: string;
  nickname: string;
  avatarKey: AvatarKey;
  avatarColor: AvatarColor;
  isHost: boolean;
  isDj: boolean;
  isConnected: boolean;
}

export interface StoredRoom {
  id: string;
  code: string;
  gameKey: string;
  gameConfig: GameConfig;
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
  updateDjRole(code: string, playerId: string, isDj: boolean): Promise<StoredRoom | null>;
  updateGameConfig(code: string, gameConfig: GameConfig): Promise<StoredRoom | null>;
  assignHost(code: string, playerId?: string): Promise<StoredRoom | null>;
  updateStatus(code: string, status: StoredRoom["status"]): Promise<StoredRoom | null>;
}
