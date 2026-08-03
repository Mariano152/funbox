import { createDatabaseClient } from "../../database/client.js";

const database = createDatabaseClient(2);
try {
  const [result] = await database<Array<{ recalculated: number; eligible: number }>>`
    with updated as (
      update public.music_catalog set
        total_plays = youtube_views,
        knownness_confidence = case when youtube_views is null then 0 else 100 end,
        knownness_score = case
          when youtube_views is null or youtube_views < 50000000 then 0
          else round((least(1.0, greatest(0.0,
            ln(youtube_views::numeric / 50000000) / ln(5000000000::numeric / 50000000)
          )) * 100)::numeric, 1)
        end,
        catalog_status = case
          when youtube_video_id is not null and youtube_views >= 50000000 then 'ready'
          else 'pending_metrics'
        end,
        updated_at = now()
      returning youtube_views
    )
    select count(*)::int as recalculated,
      count(*) filter (where youtube_views >= 50000000)::int as eligible
    from updated
  `;
  console.info(
    `[Knownness YouTube] recalculadas=${result.recalculated} ` +
    `elegibles50M=${result.eligible}`,
  );
} finally {
  await database.end();
}
