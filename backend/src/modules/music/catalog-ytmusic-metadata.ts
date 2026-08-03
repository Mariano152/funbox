import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createDatabaseClient } from "../../database/client.js";
import { normalizeCatalogText } from "./catalog-utils.js";

interface Track { normalized_key: string; title: string; artist: string; youtube_video_id: string }
interface Result { videoId?: string; title?: string; artists?: string[] }
interface Response { requestId?: string; results?: Result[]; error?: string }

const workers = Math.max(1, Math.min(24, Number(process.argv.find((item) =>
  item.startsWith("--workers="))?.split("=")[1] ?? 8)));
const database = createDatabaseClient(10);
const bridgePath = fileURLToPath(new URL("./ytmusic-bridge.py", import.meta.url));

class Bridge {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<string, { resolve: (result: Result | null) => void; reject: (error: Error) => void }>();
  constructor() {
    this.child = spawn("python", [bridgePath], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const response = JSON.parse(line) as Response;
        const waiter = this.pending.get(response.requestId ?? "");
        if (!waiter) return;
        this.pending.delete(response.requestId!);
        if (response.error) waiter.reject(new Error(response.error));
        else waiter.resolve(response.results?.[0] ?? null);
      } catch {}
    });
    this.child.on("exit", (code) => {
      for (const waiter of this.pending.values()) waiter.reject(new Error(`Bridge terminó: ${code}`));
      this.pending.clear();
    });
  }
  lookup(track: Track) {
    return new Promise<Result | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(track.normalized_key);
        reject(new Error("timeout de metadatos YouTube Music"));
      }, 45_000);
      this.pending.set(track.normalized_key, {
        resolve: (result) => { clearTimeout(timeout); resolve(result); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.child.stdin.write(`${JSON.stringify({ requestId: track.normalized_key,
        action: "video_metadata", videoId: track.youtube_video_id })}\n`);
    });
  }
  close() { this.child.stdin.end(); }
}

const tracks = await database<Track[]>`
  select normalized_key, title, artist, youtube_video_id
  from public.music_catalog
  where release_year between 1980 and 2026 and youtube_views > 50000000
    and (primary_genre is null or cardinality(genres)=0)
    and youtube_video_id is not null
    and not ('youtube-music-metadata-checked' = any(source_names))
  order by youtube_views desc nulls last
`;
const bridges = Array.from({ length: Math.min(workers, tracks.length) }, () => new Bridge());
let cursor = 0;
let resolved = 0;
let corrected = 0;
let errors = 0;
try {
  await Promise.all(bridges.map(async (bridge) => {
    while (true) {
      const track = tracks[cursor++];
      if (!track) return;
      try {
        const metadata = await bridge.lookup(track);
        const title = metadata?.title?.trim().slice(0, 200);
        const artist = metadata?.artists?.filter(Boolean).join(", ").trim().slice(0, 200);
        const usable = metadata?.videoId === track.youtube_video_id && title && artist;
        const changed = Boolean(usable && (normalizeCatalogText(title) !== normalizeCatalogText(track.title) ||
          normalizeCatalogText(artist) !== normalizeCatalogText(track.artist)));
        await database`
          update public.music_catalog set
            title=case when ${Boolean(usable)} then ${title ?? track.title} else title end,
            artist=case when ${Boolean(usable)} then ${artist ?? track.artist} else artist end,
            source_names=(select array(select distinct value from unnest(
              array_remove(array_remove(array_remove(source_names, 'itunes-genre-checked'),
                'musicbrainz-genre-checked'), 'lastfm-genre-checked') ||
              ${["youtube-music-metadata-checked", ...(usable ? ["youtube-music-metadata"] : [])]}::text[]
            ) value)),
            enrichment_error=null, metadata_checked_at=now(), updated_at=now()
          where normalized_key=${track.normalized_key}
        `;
        if (usable) resolved += 1;
        if (changed) corrected += 1;
      } catch (error) {
        errors += 1;
        await database`
          update public.music_catalog set
            source_names=(select array(select distinct value from unnest(source_names ||
              array['youtube-music-metadata-error']) value)),
            enrichment_error=${error instanceof Error ? error.message : String(error)}, updated_at=now()
          where normalized_key=${track.normalized_key}
        `;
      }
      const reviewed = Math.min(cursor, tracks.length);
      if (reviewed % 25 === 0 || reviewed === tracks.length) console.info(
        `[YTM-METADATOS] revisadas=${reviewed}/${tracks.length} resueltas=${resolved} ` +
        `corregidas=${corrected} errores=${errors}`,
      );
    }
  }));
} finally {
  bridges.forEach((bridge) => bridge.close());
  await database.end();
}
