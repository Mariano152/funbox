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

export interface RoomPlayer {
  id: string;
  nickname: string;
  avatarKey: AvatarKey;
  avatarColor: AvatarColor;
  isHost: boolean;
  isConnected: boolean;
}

export interface Room {
  id: string;
  code: string;
  status: "lobby" | "playing" | "finished";
  players: RoomPlayer[];
  createdAt: string;
}

export interface PlayerSession {
  code: string;
  playerId: string;
  nickname: string;
  reconnectToken: string;
}
