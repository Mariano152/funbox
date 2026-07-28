import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "./client.js";

const database = createDatabaseClient(1);
const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../supabase/migrations",
);

try {
  await database`
    create table if not exists public.funbox_schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const sqlText = await readFile(resolve(migrationsDirectory, filename), "utf8");
    const checksum = createHash("sha256").update(sqlText).digest("hex");
    const [existing] = await database<{ checksum: string }[]>`
      select checksum
      from public.funbox_schema_migrations
      where filename = ${filename}
    `;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`La migración aplicada fue modificada: ${filename}`);
      }
      console.log(`skip  ${filename}`);
      continue;
    }

    await database.begin(async (transaction) => {
      await transaction.unsafe(sqlText);
      await transaction`
        insert into public.funbox_schema_migrations (filename, checksum)
        values (${filename}, ${checksum})
      `;
    });

    console.log(`apply ${filename}`);
  }
} finally {
  await database.end();
}
