import { EventEmitter } from "node:events";
import type { TriviaPublicState } from "./trivia.types.js";
export const triviaEvents = new EventEmitter();
export function publishTriviaUpdated(code: string, state: TriviaPublicState) {
  triviaEvents.emit("trivia:updated", { code, state });
}
