import { env } from "../../config/env.js";
import { catalogKey } from "./catalog-utils.js";
import { findMusicBrainzYouTubeIds } from "./musicbrainz-youtube.service.js";

export interface YouTubeTrackVideo {
  videoId: string;
  durationSeconds: number;
  viewCount?: number;
  publishedAt?: string;
  viewsVideoId?: string;
  embeddable?: boolean;
}

const videoCache = new Map<string, YouTubeTrackVideo>();

async function youtubeHttpError(response: Response, operation: string) {
  const detail = (await response.text()).slice(0, 1_500);
  return new Error(`${operation} respondiÃ³ ${response.status}; detalle=${detail}`);
}

function parseIsoDuration(value: string) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

async function getYouTubeVideoDetailsBatch(videoIds: string[]) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY no estÃ¡ configurada");
  const details = new URL("https://www.googleapis.com/youtube/v3/videos");
  details.searchParams.set("part", "contentDetails,status,statistics,snippet");
  details.searchParams.set("id", videoIds.join(","));
  details.searchParams.set("key", env.YOUTUBE_API_KEY);
  const response = await fetch(details);
  if (!response.ok) throw await youtubeHttpError(response, "YouTube Videos");
  const payload = await response.json() as {
    items?: Array<{
      id?: string;
      contentDetails?: { duration?: string };
      status?: { embeddable?: boolean };
      statistics?: { viewCount?: string };
      snippet?: { publishedAt?: string };
    }>;
  };
  return (payload.items ?? []).flatMap((video) => {
    const durationSeconds = parseIsoDuration(video.contentDetails?.duration ?? "");
    if (!video.id || durationSeconds < 45) return [];
    return [{
      videoId: video.id,
      durationSeconds,
      viewCount: video.statistics?.viewCount ? Number(video.statistics.viewCount) : undefined,
      publishedAt: video.snippet?.publishedAt,
      embeddable: Boolean(video.status?.embeddable),
    } satisfies YouTubeTrackVideo];
  });
}

export async function findYouTubeVideo(
  title: string,
  artist: string,
  sources: { cachedVideoId?: string | null; recordingMbid?: string } = {},
) {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY no estÃ¡ configurada");
  const key = catalogKey(title, artist);
  const memoryCached = videoCache.get(key);
  if (memoryCached) return memoryCached;

  // The catalog video is authoritative and avoids an unnecessary MusicBrainz
  // request for almost every candidate in a normal game.
  if (sources.cachedVideoId) {
    const [catalogVideo] = await getYouTubeVideoDetailsBatch([sources.cachedVideoId]);
    if (catalogVideo?.embeddable) {
      console.info(
        `[Música][YouTube ID] ✓ ${title} — ${artist} | id=${catalogVideo.videoId} ` +
        "origen=catálogo SearchQueries=0.",
      );
      videoCache.set(key, catalogVideo);
      return catalogVideo;
    }
  }

  const musicBrainzIds = await findMusicBrainzYouTubeIds(sources.recordingMbid).catch((error) => {
    console.warn(
      `[MÃºsica][MusicBrainz video] ${title} â€” ${artist} | ` +
      `${error instanceof Error ? error.message : String(error)}; SearchQueries=0.`,
    );
    return [];
  });
  const sourceIds = musicBrainzIds;
  if (sourceIds.length) {
    const sourceVideos = await getYouTubeVideoDetailsBatch([...new Set(sourceIds)]);
    const playbackVideo = sourceVideos
      .filter((video) => video.embeddable)
      .sort((left, right) => (right.viewCount ?? 0) - (left.viewCount ?? 0))[0];
    if (playbackVideo) {
      console.info(
        `[MÃºsica][YouTube ID] âœ“ ${title} â€” ${artist} | id=${playbackVideo.videoId} ` +
        `origen=${sources.cachedVideoId === playbackVideo.videoId ? "catÃ¡logo" : "MusicBrainz"} ` +
        `SearchQueries=0.`,
      );
      videoCache.set(key, playbackVideo);
      return playbackVideo;
    }
  }

  throw new Error(
    `Sin videoId en el catÃ¡logo ni relaciÃ³n de YouTube en MusicBrainz; ` +
    `YouTube Search estÃ¡ desactivado (SearchQueries=0)`,
  );
}

export async function getYouTubeVideoDetails(videoId: string) {
  const video = (await getYouTubeVideoDetailsBatch([videoId]))[0];
  if (!video?.embeddable) throw new Error("El video encontrado no puede usarse en el reproductor");
  return video;
}

export function randomInterval(durationSeconds: number, clipDuration: number) {
  const lowerBound = Math.min(30, Math.max(5, Math.floor(durationSeconds * 0.1)));
  const upperBound = durationSeconds - clipDuration - 15;
  const available = Math.max(0, upperBound - lowerBound);
  const startSeconds = lowerBound + Math.floor(Math.random() * (available + 1));
  return { startSeconds, endSeconds: startSeconds + clipDuration };
}
