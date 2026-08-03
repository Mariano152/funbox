import { z } from "zod";

export const musicCodeParamsSchema = z.object({
  code: z.string().trim().toUpperCase().length(4).regex(/^[A-Z]+$/),
});

export const djTokenBodySchema = z.object({
  djToken: z.string().min(32),
});

export const connectDjBodySchema = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string().min(32),
});

export const manualTrackBodySchema = djTokenBodySchema.extend({
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().min(1).max(160),
  youtubeUrl: z.string().url(),
});

export const musicAnswerBodySchema = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string().min(32),
  song: z.string().trim().max(160).default(""),
  artist: z.string().trim().max(160).default(""),
}).refine((input) => input.song.length > 0 || input.artist.length > 0, {
  message: "Escribe una canción o un artista",
});

export const musicDraftBodySchema = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string().min(32),
  roundNumber: z.number().int().positive(),
  song: z.string().trim().max(160).default(""),
  artist: z.string().trim().max(160).default(""),
});

export const musicSuggestionsQuerySchema = z.object({
  type: z.enum(["song", "artist"]),
  q: z.string().trim().min(2).max(80),
});

export const pauseMusicBodySchema = z.object({
  paused: z.boolean(),
});
