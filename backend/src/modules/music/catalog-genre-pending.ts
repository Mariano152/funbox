import { createDatabaseClient } from "../../database/client.js";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const offset = Math.max(0, Number(args.get("offset") ?? 0));
const limit = Math.max(1, Math.min(500, Number(args.get("limit") ?? 100)));

const database = createDatabaseClient(1);
try {
  const rows = await database<Array<{
    normalized_key: string; title: string; artist: string; release_year: number;
    youtube_video_id: string; youtube_views: number; tags: string[]; source_names: string[];
  }>>`
    select normalized_key, title, artist, release_year, youtube_video_id,
      youtube_views, tags, source_names
    from public.music_catalog
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and catalog_status <> 'rejected'
      and (primary_genre is null or cardinality(genres)=0)
    order by youtube_views desc, artist, title
    offset ${offset}
    limit ${limit}
  `;
  console.info(`offset=${offset}\tlimit=${limit}\treturned=${rows.length}`);
  for (const row of rows) {
    console.info([
      row.youtube_video_id,
      row.release_year,
      row.youtube_views,
      row.artist.replaceAll("\t", " "),
      row.title.replaceAll("\t", " "),
    ].join("\t"));
  }
} finally {
  await database.end();
}
