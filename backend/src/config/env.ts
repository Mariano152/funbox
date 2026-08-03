import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  YOUTUBE_API_KEY: z.string().optional(),
  MUSICBRAINZ_USER_AGENT: z.string().default("Funbox/0.1 (http://localhost:3000)"),
  MUSIC_DEBUG: z.string().optional().transform((value) => value === "true"),
  MUSIC_MIN_YOUTUBE_VIEWS: z.coerce.number().int().nonnegative().default(50_000_000),
});

export const env = envSchema.parse(process.env);
