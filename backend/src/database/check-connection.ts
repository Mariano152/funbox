import { createDatabaseClient } from "./client.js";

const database = createDatabaseClient(1);

try {
  const [result] = await database<{
    database_name: string;
    server_time: string;
  }[]>`
    select
      current_database() as database_name,
      now()::text as server_time
  `;

  console.log(
    JSON.stringify({
      connected: true,
      database: result.database_name,
      serverTime: result.server_time,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      connected: false,
      message: error instanceof Error ? error.message : "Error desconocido",
    }),
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
