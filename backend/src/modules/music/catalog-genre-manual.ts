import { createDatabaseClient } from "../../database/client.js";

type Classification = { primary: string; tags: string[] };

const groups: Array<[string[], Classification]> = [
  [["TiM_TFpT_DE"], { primary: "bachata", tags: ["latin", "bachata", "dominican"] }],
  [["UDk6PpZUXSM", "NAVzjKNa6ro", "2t4s1peIZfU", "LExSwglVFIw", "MOt6-PXpwFQ", "SAhvNbngQc4", "WQlUr8E31Bw"], { primary: "regional mexicano", tags: ["latin", "regional mexicano", "corridos"] }],
  [["Qm_tHR9iwGo", "B6bDkrFLi64", "yYVCf-y2YmE", "Pw_Zemf6Wjs"], { primary: "reggaeton", tags: ["latin", "urbano latino", "reggaeton"] }],
  [["wVib5FsxtMQ"], { primary: "dembow", tags: ["latin", "dembow", "dominican"] }],
  [["7V3zyLm82_4"], { primary: "cumbia", tags: ["latin", "cumbia", "uruguayan"] }],
  [["KUN5Uf9mObQ", "8FAUEv_E_xQ", "lM8h5Mm6ODo", "592mNGkpYig", "RVLNBVK8auM", "zuVV9Y55gvc", "1F3hm6MfR1k", "MrzkoLKpgLU", "eqBrHvdGbOY"], { primary: "tamil film music", tags: ["indian", "tamil", "film soundtrack"] }],
  [["vdY5SFZBgnk", "u_wB6byrl5k", "M-954V9LORI", "Vbu44JdN12s", "I8c0-NEBqL0", "c9fXiv1UELo", "XeGdY8RoxQY", "Ldn11dMHTJ8", "MFkgFGrpQWA"], { primary: "telugu film music", tags: ["indian", "telugu", "film soundtrack"] }],
  [["sqmNziU3OxQ", "X7WXHhokylc", "87JIOAX3njM", "Tc8kb5HBNrA", "suk3mW0tDPA", "6GxXehkPyBs", "2JBYnvUlAEc", "0OLJaYETWoA", "eizIc5eQiEM", "9Z79T_o4v8c", "lwv_0SEJ4NQ"], { primary: "bollywood", tags: ["indian", "hindi", "film soundtrack", "bollywood"] }],
  [["cQM55aOrZCg", "qZId59qml_4", "W3y-tkuLhvY", "7ltVttIHwwI", "PZOMS3Yc_iU", "cgn1-0Wv3TE"], { primary: "bhojpuri", tags: ["indian", "bhojpuri", "regional folk"] }],
  [["VuG7ge_8I2Y"], { primary: "indian pop", tags: ["indian", "hindi", "pop"] }],
  [["BtQp2U6hJII", "8-gxHIOSZNA", "QHJstKwI0Ic"], { primary: "punjabi pop", tags: ["indian", "punjabi", "pop"] }],
  [["FYIDBhtSuzw"], { primary: "devotional", tags: ["indian", "hindi", "devotional", "film soundtrack"] }],
  [["VzT2xurZrbI"], { primary: "malayalam film music", tags: ["indian", "malayalam", "film soundtrack"] }],
  [["a1wW0AjQCI8"], { primary: "thai pop", tags: ["thai", "pop", "folk pop"] }],
  [["oMwm_Km9YhU", "TSsfTJ5OxTo", "JlFuxNTYZmk", "7zMd3OXwkV0"], { primary: "luk thung", tags: ["thai", "luk thung", "country", "isan"] }],
  [["HDv-A4-ad0k"], { primary: "islamic devotional", tags: ["arabic", "devotional", "latmiyya"] }],
  [["gnMdTTeY1FY"], { primary: "arabic pop", tags: ["arabic", "pop", "iraqi"] }],
  [["JbtAdvqNXbk"], { primary: "mahraganat", tags: ["arabic", "egyptian", "mahraganat"] }],
  [["fQBqaga9ElU"], { primary: "turkish pop", tags: ["turkish", "pop"] }],
  [["dEjA3uw5s3I"], { primary: "forró", tags: ["brazilian", "forró", "piseiro"] }],
  [["8NjXVsLHIg8", "DhAyaNGCnGo"], { primary: "funk brasileiro", tags: ["brazilian", "funk carioca", "baile funk"] }],
  [["FikN-MxEAmI"], { primary: "pagode", tags: ["brazilian", "pagode", "samba"] }],
  [["6j928wBZ_Bo"], { primary: "k-pop", tags: ["k-pop", "hip hop", "dance"] }],
  [["cSqOY5nktfg"], { primary: "k-pop", tags: ["k-pop", "pop", "dance"] }],
  [["MBtYzeclXvU", "yPbF6BlmzV4", "cSnywL5WEcc", "BHep3SgCplM", "gXmhEiru2pU"], { primary: "hip hop", tags: ["hip hop", "rap", "trap"] }],
  [["gjvTQTGogUM"], { primary: "latin alternative", tags: ["latin", "latin alternative", "reggaeton"] }],
  [["aVM8-TXXxsQ", "Fc8d4Mb8m1A", "DplawA83a_k"], { primary: "pop", tags: ["pop", "dance-pop"] }],
  [["-6PlJw7mkEA", "d4pI-AtJ8LA"], { primary: "r&b", tags: ["r&b", "hip hop"] }],
  [["U5AfCwh1J9Y"], { primary: "electronic", tags: ["electronic", "dance", "tropical house"] }],
  [["bwB7QDcPz2A", "nXvVVXUNld8"], { primary: "country", tags: ["country", "country pop"] }],
  [["7NK_JOkuSVY"], { primary: "alternative rock", tags: ["rock", "alternative rock", "nu metal"] }],
];

const classifications = new Map<string, Classification>();
for (const [ids, classification] of groups) for (const id of ids) classifications.set(id, classification);

const database = createDatabaseClient(72);
try {
  await database`
    update public.music_catalog set catalog_status='rejected',
      source_names=(select array(select distinct value from unnest(source_names || array['manual-research:not-a-song']) value)),
      enrichment_error='Excluded: full-length movie, not a music track', metadata_checked_at=now(), updated_at=now()
    where youtube_video_id='jzYxbnHHhY4'
  `;

  const entries = [...classifications.entries()];
  let cursor = 0;
  let updated = 0;
  let processed = 0;
  await Promise.all(Array.from({ length: 72 }, async () => {
    while (true) {
      const entry = entries[cursor++];
      if (!entry) return;
      const [videoId, value] = entry;
      const result = await database`
        update public.music_catalog set primary_genre=${value.primary}, genres=${[value.primary]},
          tags=(select array(select distinct tag from unnest(tags || ${value.tags}::text[]) tag limit 20)),
          source_names=(select array(select distinct source from unnest(source_names || array['manual-research']) source)),
          enrichment_error=null, metadata_checked_at=now(), updated_at=now()
        where youtube_video_id=${videoId} and catalog_status <> 'rejected'
          and (primary_genre is null or cardinality(genres)=0)
      `;
      updated += result.count;
      processed += 1;
      if (processed % 10 === 0 || processed === entries.length) {
        console.info(`[GÉNEROS][INVESTIGACIÓN] revisadas=${processed}/${entries.length} actualizadas=${updated}`);
      }
    }
  }));

  const backfilled = await database`
    update public.music_catalog set tags=array[primary_genre], updated_at=now()
    where release_year between 1980 and 2026 and youtube_views > 50000000
      and catalog_status <> 'rejected' and primary_genre is not null and cardinality(tags)=0
  `;
  console.info(`[GÉNEROS][ETIQUETAS] completadasDesdeGénero=${backfilled.count}`);

  const [{ missing, valid, tagged }] = await database<Array<{ missing: number; valid: number; tagged: number }>>`
    select count(*) filter (where primary_genre is null or cardinality(genres)=0)::int as missing,
      count(*)::int as valid, count(*) filter (where cardinality(tags)>0)::int as tagged
    from public.music_catalog where release_year between 1980 and 2026 and youtube_views > 50000000
      and catalog_status <> 'rejected'
  `;
  console.info(`[GÉNEROS][FINAL] género=${valid - missing}/${valid} faltantes=${missing} conEtiquetas=${tagged}`);
} finally {
  await database.end();
}
