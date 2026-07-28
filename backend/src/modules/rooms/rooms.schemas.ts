import { z } from "zod";

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
