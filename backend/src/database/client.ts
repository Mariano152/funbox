import postgres from "postgres";
import { env } from "../config/env.js";

export function createDatabaseClient(maxConnections = 10) {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada en backend/.env");
  }

  return postgres(env.DATABASE_URL, {
    max: maxConnections,
    ssl: "require",
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
