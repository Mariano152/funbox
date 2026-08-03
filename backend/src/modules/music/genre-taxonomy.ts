import { normalizeCatalogText } from "./catalog-utils.js";

// Families may overlap intentionally: for example, indie pop can be selected
// through either Pop or Indie. Exact normalized aliases prevent Pop from
// accidentally matching K-pop/J-pop, which happened with substring matching.
const GENRE_FAMILIES: Record<string, readonly string[]> = {
  pop: [
    "pop", "dance pop", "dance-pop", "electropop", "synth pop", "synth-pop",
    "latin pop", "indie pop", "alternative pop", "art pop", "pop rock",
  ],
  rock: [
    "rock", "hard rock", "alternative rock", "indie rock", "folk rock",
    "pop rock", "psychedelic rock", "progressive rock", "piano rock",
    "southern rock", "new wave", "britpop", "grunge", "nu metal",
  ],
  reggaeton: ["reggaeton", "urbano latino", "latin urban"],
  "hip hop": [
    "hip hop", "hip-hop", "hiphop", "conscious hip hop", "experimental hip hop",
  ],
  rap: ["rap", "trap", "drill", "pop rap"],
  "r and b": ["r&b", "r and b", "r&b/soul", "rhythm and blues", "contemporary r&b"],
  electronica: [
    "electronic", "electronica", "electrónica", "edm", "house", "electro house",
    "techno", "trance", "dubstep", "electro-industrial", "breakcore",
  ],
  dance: ["dance", "dance pop", "dance-pop", "electropop", "edm"],
  indie: ["indie", "indie pop", "indie rock", "neo-psychedelia"],
  alternativa: [
    "alternative", "alternativa", "alternativo", "alternative rock",
    "alternative pop", "alternative metal", "alternative punk", "post-hardcore",
  ],
  country: ["country", "country pop", "bluegrass"],
  metal: ["metal", "heavy metal", "alternative metal", "industrial metal", "metalcore", "nu metal"],
  punk: ["punk", "punk rock", "pop punk", "alternative punk", "hardcore", "post-hardcore"],
  funk: ["funk", "funk brasileiro", "funk carioca", "baile funk"],
  disco: ["disco"],
  soul: ["soul", "motown", "r&b/soul"],
  jazz: ["jazz"],
  blues: ["blues"],
  salsa: ["salsa"],
  cumbia: ["cumbia"],
  bachata: ["bachata"],
  "regional mexicano": [
    "regional mexicano", "regional mexican", "musica mexicana", "música mexicana",
    "banda", "norteno", "norteño", "mariachi", "corrido", "corridos",
  ],
  "k pop": ["k-pop", "k pop", "kpop", "korean pop"],
  "j pop": ["j-pop", "j pop", "jpop", "japanese pop"],
  afrobeats: ["afrobeats", "afrobeat"],
  reggae: ["reggae", "dancehall", "dub"],
  latina: [
    "latin", "latina", "latino", "musica latina", "música latina",
    "latin alternative", "latina contemporanea", "latina contemporánea",
  ],
};

function normalized(value: string) {
  return normalizeCatalogText(value).replace(/\band\b/g, "and").trim();
}

export function genreAliases(requested: string) {
  const key = normalized(requested);
  return [...new Set((GENRE_FAMILIES[key] ?? [requested]).map(normalized).filter(Boolean))];
}

export function genreAliasesFor(requested: string[]) {
  return [...new Set(requested.flatMap(genreAliases))];
}

export function genreExclusionsFor(requested: string[]) {
  const selected = new Set(requested.map(normalized));
  if (!selected.has("pop")) return [];
  return [
    ...(!selected.has("k pop") ? genreAliases("K-pop") : []),
    ...(!selected.has("j pop") ? genreAliases("J-pop") : []),
  ];
}

export function genreMatches(actual: string, requested: string) {
  if (!requested.trim()) return true;
  const actualGenre = normalized(actual);
  return Boolean(actualGenre) && genreAliases(requested).includes(actualGenre);
}
