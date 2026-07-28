import { EventEmitter } from "node:events";
import type { StoredRoom } from "./rooms.repository.js";

export const roomEvents = new EventEmitter();

export function publishRoomUpdated(room: StoredRoom) {
  roomEvents.emit("room:updated", room);
}
