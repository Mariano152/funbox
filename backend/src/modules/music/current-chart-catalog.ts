import type { SongCandidate, SongConstraints } from "./song-ranking.service.js";
import { normalizeCatalogText } from "./catalog-utils.js";

interface AppleSong {
  artistName?: string;
  name?: string;
  releaseDate?: string;
  genres?: Array<{ name?: string }>;
}
interface AppleResponse { feed?: { results?: AppleSong[] } }

function alternate(value: string) {
  return /\b(remix|remaster(?:ed)?|live|acoustic|karaoke|sped up|slowed|nightcore|cover|instrumental|radio edit|mix)\b/i.test(value);
}

async function fetchChart(storefront: string) {
  try {
    const response = await fetch(
      `https://rss.marketingtools.apple.com/api/v2/${storefront}/music/most-played/100/songs.json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return [];
    return ((await response.json()) as AppleResponse).feed?.results ?? [];
  } catch {
    return [];
  }
}

export async function getCurrentCatalogCandidates(
  constraints: SongConstraints,
  excluded: string[],
): Promise<SongCandidate[]> {
  const currentYear = new Date().getUTCFullYear();
  const includesCurrent =
    constraints.releaseYear === currentYear ||
    Boolean((constraints.yearFrom ?? 0) <= currentYear && (constraints.yearTo ?? 0) >= currentYear);
  if (!includesCurrent) return [];

  const storefronts = [
    ["mx", "es"], ["es", "es"], ["us", "en"], ["gb", "en"], ["ca", "en"],
    ["au", "en"], ["jp", "international"], ["kr", "international"],
    ["fr", "international"], ["de", "international"], ["br", "international"],
  ].filter(([, language]) =>
    !constraints.languages?.length ||
    constraints.languages.includes("international") ||
    constraints.languages.includes(language as "es" | "en" | "international"));
  const charts = await Promise.all(storefronts.map(async ([market, language]) => ({
    market, language, songs: await fetchChart(market),
  })));
  const blocked = new Set(excluded.map(normalizeCatalogText));
  const candidates = new Map<string, SongCandidate>();

  for (let index = 0; index < 100; index += 1) {
    for (const chart of charts) {
      const song = chart.songs[index];
      if (!song?.name || !song.artistName || !song.releaseDate || alternate(song.name)) continue;
      const releaseYear = new Date(song.releaseDate).getUTCFullYear();
      if (
        (constraints.releaseYear > 0 && releaseYear !== constraints.releaseYear) ||
        (constraints.yearFrom && releaseYear < constraints.yearFrom) ||
        (constraints.yearTo && releaseYear > constraints.yearTo) ||
        (constraints.requiredArtist &&
          normalizeCatalogText(song.artistName) !== normalizeCatalogText(constraints.requiredArtist))
      ) continue;
      const key = normalizeCatalogText(`${song.name}|${song.artistName}`);
      if (!key || blocked.has(key)) continue;
      const existing = candidates.get(key);
      if (existing) {
        existing.appleBestRank = Math.min(existing.appleBestRank ?? 100, index + 1);
        existing.appleMarketCount = (existing.appleMarketCount ?? 1) + 1;
        continue;
      }
      candidates.set(key, {
        source: "apple",
        title: song.name,
        artist: song.artistName,
        releaseYear,
        genre: song.genres?.[0]?.name ?? "",
        tags: song.genres?.flatMap((genre) => genre.name ?? []) ?? [],
        semanticDescription:
          `Canción de ${releaseYear} presente en Apple Music Charts. ` +
          `Géneros: ${song.genres?.flatMap((genre) => genre.name ?? []).join(", ") || "sin datos"}.`,
        difficultyScore: Math.min(85, 15 + Math.round(index * 0.7)),
        language: chart.language,
        appleBestRank: index + 1,
        appleMarketCount: 1,
      });
    }
  }
  const result = [...candidates.values()]
    .sort((a, b) =>
      (b.appleMarketCount ?? 0) - (a.appleMarketCount ?? 0) ||
      (a.appleBestRank ?? 100) - (b.appleBestRank ?? 100))
    .slice(0, 80);
  console.info(`[Música][Apple Charts] ${result.length} candidatos actuales; ${charts.length} mercados.`);
  return result;
}
