import { API_URL } from "@/features/rooms/room.api";
import type { PlayerSession } from "@/features/rooms/room.types";

export interface MusicAnswerResult {
  songCorrect: boolean;
  artistCorrect: boolean;
  submitted: boolean;
}

export type MusicPhase =
  | "waiting_for_dj"
  | "ready"
  | "loading"
  | "playing"
  | "answering"
  | "paused"
  | "reveal"
  | "finished"
  | "error";

export interface MusicPublicState {
  djConnected: boolean;
  phase: MusicPhase;
  roundNumber: number;
  totalRounds: number;
  clipDuration: number;
  answerDuration: number;
  startSeconds?: number;
  endSeconds?: number;
  videoId?: string;
  deadlineAt?: string;
  revealedTrack?: { title: string; artist: string };
  answerResults?: Record<string, MusicAnswerResult>;
  scores?: Record<string, number>;
  error?: string;
  pausedPhase?: "playing" | "answering";
  pausedRemainingMs?: number;
}

async function musicRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}/api/music${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "No pudimos controlar la música");
  return body as T;
}

export function connectDj(code: string, session: PlayerSession) {
  return musicRequest<{ djToken: string; state: MusicPublicState }>(`/${code}/dj/connect`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
    }),
  });
}

export function getMusicState(code: string) {
  return musicRequest<MusicPublicState>(`/${code}/state`);
}

export function submitMusicAnswer(
  session: PlayerSession,
  answer: { song: string; artist: string },
) {
  return musicRequest<{
    result: MusicAnswerResult;
    score: number;
    state: MusicPublicState;
  }>(`/${session.code}/answers`, {
    method: "POST",
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
      ...answer,
    }),
  });
}

export function saveMusicAnswerDraft(
  session: PlayerSession,
  draft: { roundNumber: number; song: string; artist: string },
) {
  return musicRequest<{ saved: true }>(`/${session.code}/answers/draft`, {
    method: "PUT",
    keepalive: true,
    body: JSON.stringify({
      playerId: session.playerId,
      reconnectToken: session.reconnectToken,
      ...draft,
    }),
  });
}

export function getMusicSuggestions(type: "song" | "artist", query: string) {
  const params = new URLSearchParams({ type, q: query });
  return musicRequest<{ suggestions: string[] }>(`/suggestions?${params}`);
}

function djAction(code: string, action: "prepare" | "started" | "finish-clip" | "reveal", djToken: string) {
  return musicRequest<MusicPublicState>(`/${code}/rounds/${action}`, {
    method: "POST",
    body: JSON.stringify({ djToken }),
  });
}

export const prepareMusicRound = (code: string, token: string) => djAction(code, "prepare", token);
export const markMusicStarted = (code: string, token: string) => djAction(code, "started", token);
export const finishMusicClip = (code: string, token: string) => djAction(code, "finish-clip", token);
export const revealMusicRound = (code: string, token: string) => djAction(code, "reveal", token);

export function setMusicPaused(code: string, paused: boolean) {
  return musicRequest<MusicPublicState>(`/${code}/pause`, {
    method: "PATCH",
    body: JSON.stringify({ paused }),
  });
}

export function returnMusicToLobby(code: string) {
  return musicRequest(`/${code}/return-to-lobby`, { method: "POST", body: "{}" });
}

export function prepareManualMusicRound(
  code: string,
  djToken: string,
  input: { title: string; artist: string; youtubeUrl: string },
) {
  return musicRequest<MusicPublicState>(`/${code}/rounds/manual`, {
    method: "POST",
    body: JSON.stringify({ djToken, ...input }),
  });
}
