export type RoomStatus = "lobby" | "playing" | "finished";

export interface RoomPlayer {
  id: string;
  nickname: string;
  avatarColor: "cyan" | "purple" | "pink" | "lime";
  isHost: boolean;
  isConnected: boolean;
}

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  players: RoomPlayer[];
  createdAt: string;
}

export interface CreateRoomResponse {
  room: Room;
  hostToken: string;
}

export interface JoinRoomInput {
  nickname: string;
}
