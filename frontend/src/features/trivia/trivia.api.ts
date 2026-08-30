import { API_URL } from "@/features/rooms/room.api"; import type { PlayerSession, Room } from "@/features/rooms/room.types"; import type { TriviaState } from "./trivia.types";
async function request<T>(path: string, init?: RequestInit) { const response = await fetch(`${API_URL}/api/trivia${path}`, { ...init, headers: { "Content-Type": "application/json" } }); const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "No pudimos controlar la trivia"); return body as T; }
export const getTriviaState = (code: string) => request<TriviaState>(`/${code}/state`);
export const nextTrivia = (code: string) => request<TriviaState>(`/${code}/next`, { method: "POST", body: "{}" });
export const revealTrivia = (code: string) => request<TriviaState>(`/${code}/reveal`, { method: "POST", body: "{}" });
export const replayTrivia = (code: string) => request<Room>(`/${code}/replay`, { method: "POST", body: "{}" });
export const pauseTrivia = (code: string, paused: boolean) => request<TriviaState>(`/${code}/pause`, { method: "PATCH", body: JSON.stringify({ paused }) });
export const answerTrivia = (session: PlayerSession, optionIndex: number) => request<TriviaState>(`/${session.code}/answers`, { method: "POST", body: JSON.stringify({ playerId: session.playerId, reconnectToken: session.reconnectToken, optionIndex }) });
