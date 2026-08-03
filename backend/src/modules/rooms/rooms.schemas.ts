import { z } from "zod";

export const createRoomBodySchema = z.object({
  gameKey: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
  gameConfig: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
  ).default({}),
});

export const roomCodeParamsSchema = z.object({
  code: z.string().trim().toUpperCase().length(4).regex(/^[A-Z]+$/),
});

export const joinRoomBodySchema = z.object({
  nickname: z.string().trim().min(1).max(16),
  reconnectToken: z.string().min(32).optional(),
});

export const startRoomBodySchema = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string().min(32),
});

export const changeAvatarBodySchema = z.object({
  playerId: z.string().uuid(),
  reconnectToken: z.string().min(32),
  avatarKey: z.enum([
    "nerd",
    "athlete",
    "royal",
    "gardener",
    "rocker",
    "astronaut",
    "chef",
    "detective",
    "artist",
  ]),
});

export const changeDjBodySchema = startRoomBodySchema.extend({
  isDj: z.boolean(),
});

export const updateMusicConfigBodySchema = z.object({
  genres: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  languages: z.array(z.enum(["es", "en", "international"])).max(3).default([]),
  yearFrom: z.coerce.number().int().min(1900).max(2100),
  yearTo: z.coerce.number().int().min(1900).max(2100),
  artists: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  difficulties: z.array(z.enum(["easy", "medium", "hard"])).max(3).default([]),
  difficulty: z.enum(["any", "easy", "medium", "hard"]).optional(),
  clipDuration: z.coerce.number().int().min(10).max(30),
  answerDuration: z.coerce.number().int().min(10).max(120),
  rounds: z.coerce.number().int().min(1).max(20),
  playbackMode: z.literal("youtube").default("youtube"),
  prompt: z.string().trim().max(500).default(""),
}).refine((value) => value.yearFrom <= value.yearTo, {
  message: "El año inicial no puede ser posterior al año final",
  path: ["yearFrom"],
});
