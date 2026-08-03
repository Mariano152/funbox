import { createDatabaseClient } from "../../database/client.js";

const execute = process.argv.includes("--execute");
const database = createDatabaseClient(2);
try {
  const coverage = await database<Array<{
    release_year: number;
    total: number;
    eligible: number;
    removable: number;
  }>>`
    select release_year,
      count(*)::int as total,
      count(*) filter (where youtube_views > 50000000)::int as eligible,
      count(*) filter (where youtube_views is null or youtube_views <= 50000000)::int as removable
    from public.music_catalog
    where release_year between 1980 and 2026
    group by release_year
    order by release_year
  `;
  const total = coverage.reduce((sum, year) => sum + year.total, 0);
  const eligible = coverage.reduce((sum, year) => sum + year.eligible, 0);
  const removable = coverage.reduce((sum, year) => sum + year.removable, 0);
  console.info(`[Catálogo 50M] total=${total} conservables=${eligible} eliminables=${removable}`);
  coverage.forEach((year) => console.info(
    `[Catálogo 50M] año=${year.release_year} elegibles=${year.eligible}/100 ` +
    `totalActual=${year.total} eliminables=${year.removable}`,
  ));
  if (!execute) {
    console.info("[Catálogo 50M] Vista previa; agrega --execute para eliminar.");
  } else {
    const [deleted] = await database<Array<{ count: number }>>`
      with removed as (
        delete from public.music_catalog
        where youtube_views is null or youtube_views <= 50000000
        returning 1
      )
      select count(*)::int as count from removed
    `;
    await database`
      update public.music_catalog_year_targets as targets set
        target_count = 100,
        imported_count = stats.count,
        ready_count = stats.count,
        metadata_completed_at = case when stats.count >= 100 then now() else null end,
        enrichment_completed_at = case when stats.count >= 100 then now() else null end,
        updated_at = now()
      from (
        select years.release_year, count(catalog.id)::int as count
        from generate_series(1980, 2026) as years(release_year)
        left join public.music_catalog catalog
          on catalog.release_year = years.release_year
        group by years.release_year
      ) stats
      where targets.release_year = stats.release_year
    `;
    console.info(`[Catálogo 50M] eliminadas=${deleted.count}; operación irreversible completada.`);
  }
} finally {
  await database.end();
}
