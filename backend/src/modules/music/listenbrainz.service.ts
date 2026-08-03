import type { SongCandidate } from "./song-ranking.service.js";
import { normalizeCatalogText } from "./catalog-utils.js";

interface Popularity {
  recording_mbid?: string;
  artist_mbid?: string;
  total_listen_count?: number | null;
  total_user_count?: number | null;
}

interface TopRecording extends Popularity {
  recording_name?: string;
}

const topRecordingsByArtist = new Map<string, Promise<TopRecording[]>>();

async function requestPopularity(path: "recording" | "artist", ids: string[]) {
  if (!ids.length) return [] as Popularity[];
  const response = await fetch(`https://api.listenbrainz.org/1/popularity/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      [path === "recording" ? "recording_mbids" : "artist_mbids"]: ids,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ListenBrainz ${path} HTTP ${response.status}`);
  return await response.json() as Popularity[];
}

export async function enrichWithListenBrainz(candidates: SongCandidate[]) {
  const recordings = [...new Set(candidates.flatMap((track) => track.recordingMbid ?? []))];
  const artists = [...new Set(candidates.flatMap((track) => track.artistMbid ?? []))];
  try {
    const [recordingRows, artistRows] = await Promise.all([
      requestPopularity("recording", recordings),
      requestPopularity("artist", artists),
    ]);
    const byRecording = new Map(recordingRows.map((row) => [row.recording_mbid, row]));
    const byArtist = new Map(artistRows.map((row) => [row.artist_mbid, row]));
    return candidates.map((track) => {
      const recording = byRecording.get(track.recordingMbid);
      const artist = byArtist.get(track.artistMbid);
      return {
        ...track,
        listenbrainzUsers: recording?.total_user_count ?? track.listenbrainzUsers,
        listenbrainzListens: recording?.total_listen_count ?? track.listenbrainzListens,
        artistUsers: artist?.total_user_count ?? track.artistUsers,
        artistListens: artist?.total_listen_count ?? track.artistListens,
      };
    });
  } catch (error) {
    console.warn(`[Música][ListenBrainz] ${error instanceof Error ? error.message : String(error)}; se continúa con las demás señales.`);
    return candidates;
  }
}

async function getTopRecordingsForArtist(artistMbid: string) {
  let pending = topRecordingsByArtist.get(artistMbid);
  if (!pending) {
    pending = fetch(
      `https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${artistMbid}`,
      { signal: AbortSignal.timeout(15_000) },
    ).then(async (response) => {
      if (!response.ok) throw new Error(`ListenBrainz top recordings HTTP ${response.status}`);
      return await response.json() as TopRecording[];
    });
    topRecordingsByArtist.set(artistMbid, pending);
  }
  return pending;
}

/**
 * MusicBrainz can return several recording MBIDs for the same song. Only use
 * recording-level popularity when ListenBrainz itself associates the exact
 * title with the artist; otherwise preserve artist popularity and mark the
 * recording evidence as unavailable.
 */
export async function resolveCanonicalListenBrainz(track: SongCandidate): Promise<SongCandidate> {
  const withoutUnverifiedRecording = {
    ...track,
    listenbrainzUsers: null,
    listenbrainzListens: null,
  };
  if (!track.artistMbid) return withoutUnverifiedRecording;
  try {
    const expected = normalizeCatalogText(track.title);
    const rows = await getTopRecordingsForArtist(track.artistMbid);
    const match = rows.find((row) =>
      normalizeCatalogText(row.recording_name ?? "") === expected);
    if (!match) return withoutUnverifiedRecording;
    return {
      ...track,
      recordingMbid: match.recording_mbid ?? track.recordingMbid,
      listenbrainzUsers: match.total_user_count ?? null,
      listenbrainzListens: match.total_listen_count ?? null,
    };
  } catch (error) {
    console.warn(
      `[Música][ListenBrainz] ${track.title} — ${track.artist}: ` +
      `${error instanceof Error ? error.message : String(error)}; métricas de grabación omitidas.`,
    );
    return withoutUnverifiedRecording;
  }
}
