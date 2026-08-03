import { searchItunes } from "./itunes-client.js";

const resultCache = new Map<string, { expiresAt: number; values: string[] }>();

function cleanTrackTitle(value: string) {
  return value
    .replace(/\s*[-–]\s*(?:remix|remaster(?:ed)?|live|radio edit|acoustic|karaoke|sped up|slowed).*$/i, "")
    .replace(/\s*\([^)]*(?:remix|remaster(?:ed)?|live|version|radio edit|acoustic|karaoke|sped up|slowed|feat\.?|ft\.?)[^)]*\)/gi, "")
    .trim();
}

function isAlternateVersion(value: string) {
  return /\b(remix|remaster(?:ed)?|live|radio edit|acoustic|karaoke|sped up|slowed|instrumental|cover|mix)\b/i.test(value);
}

export async function searchMusicSuggestions(type: "song" | "artist", rawQuery: string) {
  const query = rawQuery.trim();
  if (query.length < 3) return [];
  const key = `${type}:${query.toLocaleLowerCase()}`;
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.values;

  try {
    const results = await searchItunes(query, { limit: 10, ttlMs: 10 * 60 * 1000 });
    const values = Array.from(new Set(
      results
        .filter((result) => result.kind === "song")
        .filter((result) => type === "artist" || !isAlternateVersion(result.trackName ?? ""))
        .map((result) => type === "song" && result.trackName
          ? cleanTrackTitle(result.trackName)
          : result.artistName)
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    )).slice(0, 7);
    resultCache.set(key, { values, expiresAt: Date.now() + 10 * 60 * 1000 });
    return values;
  } catch (error) {
    console.warn(
      `[Música][Autocompletado] ${error instanceof Error ? error.message : String(error)}; respuesta vacía.`,
    );
    return [];
  }
}
