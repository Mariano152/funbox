import { createHash } from "node:crypto";
import { createDatabaseClient } from "../../database/client.js";
import {
  embedInputs,
  MUSIC_EMBEDDING_MODEL,
  MUSIC_EMBEDDING_TASK,
} from "./song-ranking.service.js";

const batchSize = Math.min(100, Math.max(1, Number(
  process.argv.find((value) => value.startsWith("--batch="))?.split("=")[1] ?? 100,
)));
const limit = Math.max(1, Number(
  process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] ?? 40_000,
));
const database = createDatabaseClient(3);
let completed = 0;

try {
  while (completed < limit) {
    const tracks = await database<Array<{
      normalized_key: string;
      title: string;
      artist: string;
      release_year: number;
      primary_genre: string | null;
      semantic_description: string | null;
    }>>`
      select normalized_key, title, artist, release_year, primary_genre, semantic_description
      from public.music_catalog
      where embedding is null or embedding_status <> 'ready'
      order by release_year desc, source_score desc nulls last, normalized_key
      limit ${Math.min(batchSize, limit - completed)}
    `;
    if (!tracks.length) break;
    const descriptions = tracks.map((track) =>
      `${track.title} de ${track.artist}. ${track.semantic_description ?? "Sin etiquetas descriptivas disponibles."}. ` +
      `GÃ©nero ${track.primary_genre ?? "sin datos"}, aÃ±o ${track.release_year}.`,
    );
    const vectors = await embedInputs(descriptions.map((text) => ({
      text,
      taskType: MUSIC_EMBEDDING_TASK,
    })));
    if (!vectors) throw new Error("Gemini no devolviÃ³ el lote de embeddings");
    const rows = tracks.map((track, index) => ({
      normalized_key: track.normalized_key,
      hash: createHash("sha256").update(descriptions[index]).digest("hex"),
      embedding: vectors[index],
    }));
    await database`
      with raw as (
        select * from jsonb_to_recordset(${database.json(rows)}) as item(
          normalized_key text, hash text, embedding jsonb
        )
      ), source as (
        select normalized_key, hash,
          array(select jsonb_array_elements_text(embedding)::real) as embedding
        from raw
      )
      update public.music_catalog catalog set
        embedding_model = ${MUSIC_EMBEDDING_MODEL},
        embedding_task = ${MUSIC_EMBEDDING_TASK},
        embedding_description_hash = source.hash,
        embedding = source.embedding,
        embedding_status = 'ready',
        embedding_updated_at = now(),
        updated_at = now()
      from source
      where catalog.normalized_key = source.normalized_key
    `;
    completed += tracks.length;
    console.info(`[CATÃLOGO EMBEDDING] ${completed}/${limit} completados.`);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  console.info(`[CATÃLOGO EMBEDDING] trabajo terminado; nuevos=${completed}.`);
} finally {
  await database.end();
}
