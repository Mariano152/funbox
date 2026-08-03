import { createDatabaseClient } from "../../database/client.js";

interface TrackRow {
  normalized_key: string;
  title: string;
  artist: string;
  musicbrainz_recording_id: string;
  youtube_views: number;
}

interface PopularityRow {
  recording_mbid?: string;
  total_listen_count?: number | null;
  total_user_count?: number | null;
}

const database = createDatabaseClient(2);
const requestedLimit = Number(
  process.argv.find((argument) => argument.startsWith("--limit="))?.split("=")[1] ?? 10_000,
);

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function logCorrelation(rows: Array<{ youtube: number; listenbrainz: number }>) {
  if (rows.length < 2) return 0;
  const points = rows.map((row) => ({
    x: Math.log10(Math.max(1, row.youtube)),
    y: Math.log10(Math.max(1, row.listenbrainz)),
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) =>
    sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = Math.sqrt(
    points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0) *
    points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0),
  );
  return denominator ? numerator / denominator : 0;
}

async function fetchPopularity(ids: string[]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.listenbrainz.org/1/popularity/recording", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_mbids: ids }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`ListenBrainz HTTP ${response.status}`);
      return await response.json() as PopularityRow[];
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

try {
  const allTracks = await database<TrackRow[]>`
    select normalized_key, title, artist, musicbrainz_recording_id, youtube_views
    from public.music_catalog
    where youtube_views > 50000000
      and musicbrainz_recording_id is not null
    order by youtube_views desc
  `;
  const tracks = allTracks.slice(0, Math.max(1, requestedLimit));
  const popularity: PopularityRow[] = [];
  let failedBatches = 0;
  for (let index = 0; index < tracks.length; index += 10) {
    const batch = tracks.slice(index, index + 10);
    try {
      popularity.push(...await fetchPopularity(batch.map((track) => track.musicbrainz_recording_id)));
    } catch (error) {
      failedBatches += 1;
      console.warn(`[Calibración ListenBrainz] lote fallido ${index / 10 + 1}: ` +
        `${error instanceof Error ? error.message : String(error)}`);
    }
    console.info(`[Calibración ListenBrainz] consultadas=${Math.min(index + 10, tracks.length)}/${tracks.length}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const byMbid = new Map(popularity.map((row) => [row.recording_mbid, row]));
  const measured = tracks.flatMap((track) => {
    const row = byMbid.get(track.musicbrainz_recording_id);
    if (row?.total_user_count == null || row.total_listen_count == null) return [];
    return [{ track, users: row.total_user_count, listens: row.total_listen_count }];
  });
  for (const row of measured) {
    await database`
      update public.music_catalog set
        listenbrainz_users = ${row.users},
        listenbrainz_listens = ${row.listens},
        updated_at = now()
      where normalized_key = ${row.track.normalized_key}
    `;
  }
  const users = measured.map((row) => row.users);
  const listens = measured.map((row) => row.listens);
  const quantiles = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90];
  console.info(`[Calibración ListenBrainz] catálogoPositivo=${tracks.length} medido=${measured.length} ` +
    `cobertura=${(measured.length / Math.max(1, tracks.length) * 100).toFixed(1)}% ` +
    `lotesFallidos=${failedBatches}`);
  for (const fraction of quantiles) console.info(
    `[Calibración ListenBrainz] p${fraction * 100} usuarios=${percentile(users, fraction)} ` +
    `escuchas=${percentile(listens, fraction)}`,
  );
  console.info(`[Calibración ListenBrainz] correlaciónLog vistas-usuarios=${logCorrelation(measured.map((row) => ({
    youtube: row.track.youtube_views, listenbrainz: row.users,
  }))).toFixed(3)} vistas-escuchas=${logCorrelation(measured.map((row) => ({
    youtube: row.track.youtube_views, listenbrainz: row.listens,
  }))).toFixed(3)}`);
  for (const threshold of [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000]) {
    const retained = measured.filter((row) => row.users >= threshold).length;
    console.info(`[Calibración ListenBrainz] umbralUsuarios=${threshold} ` +
      `retienePositivas=${retained}/${measured.length} (${(retained / Math.max(1, measured.length) * 100).toFixed(1)}%)`);
  }
} finally {
  await database.end();
}
