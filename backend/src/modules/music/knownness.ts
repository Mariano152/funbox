export interface KnownnessSignals {
  youtubeViews?: number | null;
  youtubePublishedAt?: string | Date | null;
  youtubePreviousViews?: number | null;
  youtubePreviousCheckedAt?: string | Date | null;
  youtubeCheckedAt?: string | Date | null;
  // Datos históricos conservados para compatibilidad; no afectan KnownnessScore.
  listenbrainzUsers?: number | null;
  listenbrainzListens?: number | null;
  artistUsers?: number | null;
  artistListens?: number | null;
  appleBestRank?: number | null;
  appleMarketCount?: number | null;
  appleDaysInChart?: number | null;
}

export interface KnownnessReferences {
  totalPlaysP99: number;
}

export const MIN_KNOWNNESS_TOTAL_PLAYS = 50_000_000;
export const KNOWNNESS_REFERENCES: KnownnessReferences = {
  totalPlaysP99: 5_000_000_000,
};

function totalScore(totalPlays: number, p99: number) {
  if (totalPlays < MIN_KNOWNNESS_TOTAL_PLAYS) return 0;
  if (p99 <= MIN_KNOWNNESS_TOTAL_PLAYS) return 1;
  return Math.max(
    0,
    Math.min(
      1,
      Math.log(totalPlays / MIN_KNOWNNESS_TOTAL_PLAYS) /
        Math.log(p99 / MIN_KNOWNNESS_TOTAL_PLAYS),
    ),
  );
}

export function calculateKnownness(
  signals: KnownnessSignals,
  references: KnownnessReferences = KNOWNNESS_REFERENCES,
) {
  const youtubeViews = Math.max(0, signals.youtubeViews ?? 0);
  const hasYouTube = signals.youtubeViews != null && signals.youtubeViews >= 0;
  const effectiveTotalPlays = hasYouTube ? youtubeViews : 0;
  const normalized = totalScore(effectiveTotalPlays, references.totalPlaysP99);
  const score = normalized * 100;
  return {
    score: Math.round(score * 10) / 10,
    rawScore: Math.round(score * 10) / 10,
    confidence: hasYouTube ? 100 : 0,
    eligible: hasYouTube && effectiveTotalPlays >= MIN_KNOWNNESS_TOTAL_PLAYS,
    effectiveTotalPlays: Math.round(effectiveTotalPlays),
    estimated: false,
    components: {
      youtubeViews,
      effectiveTotalPlays: Math.round(effectiveTotalPlays),
    },
  };
}
