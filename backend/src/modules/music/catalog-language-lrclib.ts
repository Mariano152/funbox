import { franc } from "franc-min";
import { createDatabaseClient } from "../../database/client.js";
import { normalizeCatalogText } from "./catalog-utils.js";

type CatalogLanguage = "es" | "en" | "international";
interface Track { id: string; title: string; artist: string }
interface LyricsMatch {
  trackName?: string;
  artistName?: string;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const limit = Math.max(1, Number(args.get("limit") ?? 100_000));
const retry = args.get("retry") === "true";
const delayMs = Math.max(200, Number(args.get("delay-ms") ?? 350));
const database = createDatabaseClient(3);

function tokens(value: string) {
  return new Set(normalizeCatalogText(value)
    .replace(/\b(feat|featuring|ft|official|audio|video|lyrics|lyric|remaster(?:ed)?)\b/g, " ")
    .split(/\s+/).filter(Boolean));
}
function overlap(expected: Set<string>, actual: Set<string>) {
  if (!expected.size) return 0;
  let matched = 0;
  for (const token of expected) if (actual.has(token)) matched += 1;
  return matched / expected.size;
}
function classify(match: LyricsMatch): CatalogLanguage | null {
  if (match.instrumental) return "international";
  const lyrics = (match.plainLyrics ?? match.syncedLyrics ?? "")
    .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, " ").trim();
  if (lyrics.length < 80) return null;
  const code = franc(lyrics, { minLength: 80 });
  if (code === "spa") return "es";
  if (code === "eng") return "en";
  return code === "und" ? null : "international";
}
async function lookup(track: Track) {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", track.title);
  url.searchParams.set("artist_name", track.artist);
  const response = await fetch(url, {
    headers: { "User-Agent": "Funbox/0.1 (catalog language enrichment)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429) {
    const seconds = Math.max(1, Number(response.headers.get("retry-after") ?? "1"));
    await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
    return lookup(track);
  }
  if (!response.ok) throw new Error(`LRCLIB HTTP ${response.status}`);
  const results = await response.json() as LyricsMatch[];
  return results.map((match) => ({
    match,
    score: overlap(tokens(track.title), tokens(match.trackName ?? "")) * 0.65 +
      overlap(tokens(track.artist), tokens(match.artistName ?? "")) * 0.35,
  })).sort((left, right) => right.score - left.score)[0];
}

const tracks = await database<Track[]>`
  select id, title, artist
  from public.music_catalog
  where language is null
    and (${retry} or not ('lrclib-language-checked' = any(source_names)))
  order by youtube_views desc nulls last, normalized_key
  limit ${limit}
`;

let labelled = 0;
let noMatch = 0;
let errors = 0;
const totals: Record<CatalogLanguage, number> = { es: 0, en: 0, international: 0 };
const startedAt = Date.now();
console.info(`[Idiomas LRCLIB][INICIO] pendientes=${tracks.length} pausa=${delayMs}ms`);

try {
  for (const [index, track] of tracks.entries()) {
    try {
      const candidate = await lookup(track);
      const language = candidate && candidate.score >= 0.88 ? classify(candidate.match) : null;
      if (language) {
        await database`
          update public.music_catalog set
            language = ${language},
            source_names = array_append(array_remove(source_names, 'lrclib-language-checked'), 'lrclib-language'),
            updated_at = now()
          where id = ${track.id}::uuid and language is null
        `;
        labelled += 1;
        totals[language] += 1;
      } else {
        noMatch += 1;
        await database`
          update public.music_catalog set
            source_names = case when 'lrclib-language-checked' = any(source_names) then source_names
              else array_append(source_names, 'lrclib-language-checked') end,
            updated_at = now()
          where id = ${track.id}::uuid and language is null
        `;
      }
    } catch (error) {
      errors += 1;
      console.warn(`[Idiomas LRCLIB][ERROR] ${track.title} — ${track.artist}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const done = index + 1;
    if (done === 1 || done % 50 === 0 || done === tracks.length) {
      const elapsedMinutes = Math.max(0.001, (Date.now() - startedAt) / 60_000);
      const rate = done / elapsedMinutes;
      console.info(`[Idiomas LRCLIB][PROGRESO] ${done}/${tracks.length} etiquetadas=${labelled} ` +
        `sinCoincidencia=${noMatch} errores=${errors} velocidad=${rate.toFixed(0)}/min ` +
        `ETA=${((tracks.length - done) / rate).toFixed(1)}min`);
    }
    if (index + 1 < tracks.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  console.info(`[Idiomas LRCLIB][FINAL] etiquetadas=${labelled} es=${totals.es} en=${totals.en} ` +
    `internacional=${totals.international} sinCoincidencia=${noMatch} errores=${errors}`);
} finally {
  await database.end();
}
