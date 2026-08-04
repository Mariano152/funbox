import { createDatabaseClient } from "../../database/client.js";
import { env } from "../../config/env.js";

type CatalogLanguage = "es" | "en" | "international";
interface Track { id: string; title: string; artist: string }
interface Answer { id: string; language: CatalogLanguage }

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const workers = Math.min(72, Math.max(1, Number(args.get("workers") ?? 72)));
const limit = Math.max(1, Number(args.get("limit") ?? 100_000));
const database = createDatabaseClient(Math.min(10, workers));
if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no está configurada");

const tracks = await database<Track[]>`
  select id, title, artist
  from public.music_catalog
  where language is null
    and 'lrclib-language-checked' = any(source_names)
    and not ('gemini-language-checked' = any(source_names))
  order by youtube_views desc nulls last, normalized_key
  limit ${limit}
`;
const batches = Array.from({ length: Math.ceil(tracks.length / 40) }, (_, index) => tracks.slice(index * 40, index * 40 + 40));
let cursor = 0;
let completed = 0;
let labelled = 0;
let errors = 0;
let quotaExhausted = false;
console.info(`[Idiomas Gemini][INICIO] pendientes=${tracks.length} lotes=${batches.length} workers=${workers}`);

async function classify(batch: Track[]): Promise<Answer[]> {
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: [
        "Clasifica el idioma vocal principal de cada canción conocida. No uses nacionalidad del artista ni idioma del título; usa el idioma en que se canta.",
        "Devuelve es para español, en para inglés e international para cualquier otro idioma, instrumental o mezcla sin idioma principal.",
        "No omitas ni inventes IDs. Canciones:", JSON.stringify(batch),
      ].join("\n") }]}],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { songs: { type: "ARRAY", items: { type: "OBJECT", properties: {
            id: { type: "STRING" }, language: { type: "STRING", enum: ["es", "en", "international"] },
          }, required: ["id", "language"] } } }, required: ["songs"],
        },
      },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    if (response.status === 429 || (response.status === 403 && /quota/i.test(detail))) quotaExhausted = true;
    throw new Error(`Gemini HTTP ${response.status}: ${detail}`);
  }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text) as { songs?: Answer[] };
  const allowed = new Set(batch.map((track) => track.id));
  return (parsed.songs ?? []).filter((answer) => allowed.has(answer.id) && ["es", "en", "international"].includes(answer.language));
}
async function processBatch(batch: Track[]) {
  try {
    const answers = await classify(batch);
    const ids = answers.map((answer) => answer.id);
    const languages = answers.map((answer) => answer.language);
    if (ids.length) await database`
      update public.music_catalog as catalog set language = data.language,
        source_names = array_append(array_remove(source_names, 'gemini-language-checked'), 'gemini-language'), updated_at = now()
      from unnest(${ids}::uuid[], ${languages}::text[]) as data(id, language)
      where catalog.id = data.id and catalog.language is null
    `;
    const checkedIds = batch.map((track) => track.id);
    await database`
      update public.music_catalog set source_names = case when 'gemini-language-checked' = any(source_names) then source_names
        else array_append(source_names, 'gemini-language-checked') end, updated_at = now()
      where id = any(${checkedIds}::uuid[]) and language is null
    `;
    labelled += ids.length;
  } catch (error) {
    errors += 1;
    console.warn(`[Idiomas Gemini][ERROR] lote=${completed + 1}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    completed += 1;
    if (completed === 1 || completed % 10 === 0 || completed === batches.length) console.info(
      `[Idiomas Gemini][PROGRESO] lotes=${completed}/${batches.length} etiquetadas=${labelled} errores=${errors}`);
  }
}
async function worker() { while (!quotaExhausted) { const batch = batches[cursor++]; if (!batch) return; await processBatch(batch); } }
try { await Promise.all(Array.from({ length: workers }, worker)); console.info(`[Idiomas Gemini][FINAL] etiquetadas=${labelled} errores=${errors} quotaAgotada=${quotaExhausted}`); }
finally { await database.end(); }
