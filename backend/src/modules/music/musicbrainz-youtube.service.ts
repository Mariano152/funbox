import { fetchMusicBrainzWithRetry } from "./musicbrainz-catalog.js";

interface MusicBrainzUrlRelation {
  type?: string;
  "target-type"?: string;
  url?: { resource?: string };
}

interface MusicBrainzRecordingRelations {
  relations?: MusicBrainzUrlRelation[];
}

function youtubeVideoId(resource: string) {
  try {
    const url = new URL(resource);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = "";
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (host === "youtube.com" || host === "music.youtube.com") {
      id = url.searchParams.get("v") ?? "";
      if (!id) {
        const segments = url.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(segments[0] ?? "")) id = segments[1] ?? "";
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function findMusicBrainzYouTubeIds(recordingMbid?: string) {
  if (!recordingMbid) return [];
  const url = new URL(`https://musicbrainz.org/ws/2/recording/${recordingMbid}`);
  url.searchParams.set("inc", "url-rels");
  url.searchParams.set("fmt", "json");
  const response = await fetchMusicBrainzWithRetry(url, "relaciones YouTube", 1);
  if (!response.ok) {
    throw new Error(`MusicBrainz relaciones respondiÃ³ HTTP ${response.status}`);
  }
  const payload = await response.json() as MusicBrainzRecordingRelations;
  return [...new Set((payload.relations ?? []).flatMap((relation) => {
    const resource = relation.url?.resource;
    if (relation["target-type"] !== "url" || !resource) return [];
    const id = youtubeVideoId(resource);
    return id ? [id] : [];
  }))];
}
