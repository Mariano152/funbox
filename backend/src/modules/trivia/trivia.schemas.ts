import { z } from "zod";
export const triviaCodeSchema = z.object({ code: z.string().trim().toUpperCase().length(4).regex(/^[A-Z]+$/) });
export const triviaConfigSchema = z.object({
  mode: z.enum(["categories", "custom"]).default("categories"),
  categories: z.array(z.enum(["history", "geography", "science", "math_logic", "language", "art_literature", "film_tv", "music", "sports", "technology", "pop_culture", "mexico"])).max(12).default([]),
  topic: z.string().trim().min(1).max(300).default("Cultura general"),
  difficulties: z.array(z.enum(["very_easy", "easy", "medium", "hard", "very_hard"])).max(5).default([]),
  difficulty: z.enum(["very_easy", "easy", "medium", "hard", "very_hard"]).optional(),
  rounds: z.coerce.number().int().min(5).max(20).default(10),
  answerDuration: z.coerce.number().int().min(10).max(60).default(20),
});
export const triviaAnswerSchema = z.object({
  playerId: z.string().uuid(), reconnectToken: z.string().min(32), optionIndex: z.number().int().min(0).max(3),
});
export const triviaPauseSchema = z.object({ paused: z.boolean() });
