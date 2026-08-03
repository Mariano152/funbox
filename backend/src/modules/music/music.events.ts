import { EventEmitter } from "node:events";
import type { MusicPublicState } from "./music.types.js";

export const musicEvents = new EventEmitter();

export function publishMusicUpdated(code: string, state: MusicPublicState) {
  musicEvents.emit("music:updated", { code, state });
}
