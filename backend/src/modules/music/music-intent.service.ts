import { env } from "../../config/env.js";
import { normalizeCatalogText } from "./catalog-utils.js";

export interface MusicIntentProfile {
  occasion: string;
  moods: string[];
  themes: string[];
  positiveTags: string[];
  negativeTags: string[];
  energy: number;
  danceability: number;
  preferredKnownness: number;
  vocalPreference: string;
  source: "local" | "gemini" | "fallback";
}

type ProfileTemplate = Omit<MusicIntentProfile, "source">;
const intentCache = new Map<string, MusicIntentProfile>();

const PROFILES: Array<{ keywords: string[]; profile: ProfileTemplate }> = [
  {
    keywords: ["bellakear", "bellaquear", "bellacoso", "perreo", "perrear"],
    profile: {
      occasion: "latin urban perreo party",
      moods: ["sensual", "bold", "energetic", "playful"],
      themes: ["attraction", "nightlife", "seduction", "dancing"],
      positiveTags: ["reggaeton", "latin urban", "dembow", "perreo", "club", "bass-heavy", "rhythmic"],
      negativeTags: ["acoustic", "classical", "ambient", "slow ballad", "children"],
      energy: 0.88, danceability: 0.98, preferredKnownness: 0.72,
      vocalPreference: "rhythmic urban vocals",
    },
  },
  {
    keywords: ["cumpleanos", "cumple", "birthday"],
    profile: {
      occasion: "birthday party",
      moods: ["joyful", "celebratory", "fun", "energetic"],
      themes: ["birthday", "friendship", "celebration", "good times"],
      positiveTags: ["party", "upbeat", "crowd-pleaser", "singalong", "dance"],
      negativeTags: ["funeral", "grief", "breakup", "sleepy"],
      energy: 0.82, danceability: 0.82, preferredKnownness: 0.82,
      vocalPreference: "famous memorable chorus",
    },
  },
  {
    keywords: ["navidad", "navidenas", "navidenos", "christmas", "posada"],
    profile: {
      occasion: "Christmas celebration",
      moods: ["festive", "warm", "joyful", "nostalgic"],
      themes: ["Christmas", "family", "togetherness", "winter", "celebration"],
      positiveTags: ["holiday", "Christmas", "festive", "family", "singalong"],
      negativeTags: ["summer", "breakup", "aggressive"],
      energy: 0.65, danceability: 0.5, preferredKnownness: 0.82,
      vocalPreference: "warm familiar vocals or festive instrumental",
    },
  },
  {
    keywords: ["halloween", "terror", "espeluznante", "miedo"],
    profile: {
      occasion: "Halloween party",
      moods: ["spooky", "dark", "playful", "mysterious"],
      themes: ["Halloween", "fear", "monsters", "night", "supernatural"],
      positiveTags: ["spooky", "dark", "theatrical", "party", "horror"],
      negativeTags: ["wedding", "sunny", "devotional", "lullaby"],
      energy: 0.72, danceability: 0.62, preferredKnownness: 0.75,
      vocalPreference: "theatrical vocal or cinematic instrumental",
    },
  },
  {
    keywords: ["romantica", "romanticas", "romance", "enamorados", "enamorado", "enamorada"],
    profile: {
      occasion: "romantic moment",
      moods: ["romantic", "warm", "tender", "intimate"],
      themes: ["love", "devotion", "attraction", "togetherness"],
      positiveTags: ["love song", "romantic", "tender", "slow dance", "intimate"],
      negativeTags: ["breakup", "betrayal", "aggressive", "comic"],
      energy: 0.42, danceability: 0.35, preferredKnownness: 0.7,
      vocalPreference: "expressive romantic vocal",
    },
  },
  {
    keywords: ["desamor", "corazon roto", "ruptura", "breakup", "superar a mi ex", "mi ex"],
    profile: {
      occasion: "heartbreak",
      moods: ["sad", "melancholic", "vulnerable", "reflective"],
      themes: ["breakup", "loss of love", "betrayal", "moving on"],
      positiveTags: ["heartbreak", "emotional", "melancholic", "ballad", "cathartic"],
      negativeTags: ["wedding", "children", "comic", "carefree romance"],
      energy: 0.32, danceability: 0.2, preferredKnownness: 0.72,
      vocalPreference: "emotionally expressive vocal",
    },
  },
  {
    keywords: ["feliz", "felices", "alegre", "alegrarme", "buen humor", "good mood"],
    profile: {
      occasion: "feel-good listening",
      moods: ["happy", "optimistic", "bright", "uplifting"],
      themes: ["joy", "freedom", "good times", "positivity"],
      positiveTags: ["feel-good", "upbeat", "bright", "catchy", "uplifting"],
      negativeTags: ["grief", "hopeless", "dark", "funeral"],
      energy: 0.72, danceability: 0.65, preferredKnownness: 0.68,
      vocalPreference: "bright vocal or cheerful instrumental",
    },
  },
  {
    keywords: ["triste", "tristes", "melancolica", "melancolicas", "deprimido", "deprimida"],
    profile: {
      occasion: "sad reflective listening",
      moods: ["sad", "melancholic", "introspective", "emotional"],
      themes: ["loneliness", "loss", "memory", "reflection"],
      positiveTags: ["melancholic", "emotional", "slow", "introspective", "ballad"],
      negativeTags: ["party", "comic", "carefree", "hype"],
      energy: 0.22, danceability: 0.1, preferredKnownness: 0.62,
      vocalPreference: "emotional vocal or reflective instrumental",
    },
  },
  {
    keywords: ["relajarme", "relajante", "relax", "descansar", "spa", "meditar", "meditacion"],
    profile: {
      occasion: "relaxation and meditation",
      moods: ["calm", "peaceful", "serene", "soothing"],
      themes: ["rest", "peace", "breathing", "stillness"],
      positiveTags: ["ambient", "soft", "meditation", "peaceful", "instrumental"],
      negativeTags: ["loud", "aggressive", "party", "dramatic"],
      energy: 0.12, danceability: 0.03, preferredKnownness: 0.3,
      vocalPreference: "instrumental or minimal soft vocals",
    },
  },
  {
    keywords: ["dormir", "sueno", "dormirme", "lullaby"],
    profile: {
      occasion: "sleep",
      moods: ["sleepy", "calm", "safe", "peaceful"],
      themes: ["sleep", "rest", "night", "comfort"],
      positiveTags: ["sleep", "ambient", "very soft", "slow", "instrumental"],
      negativeTags: ["strong beat", "loud", "energetic", "singalong"],
      energy: 0.05, danceability: 0.01, preferredKnownness: 0.2,
      vocalPreference: "instrumental or very soft minimal vocals",
    },
  },
  {
    keywords: ["playa", "verano", "alberca", "vacaciones", "beach", "summer"],
    profile: {
      occasion: "summer beach day",
      moods: ["sunny", "carefree", "joyful", "relaxed"],
      themes: ["summer", "beach", "vacation", "freedom", "good times"],
      positiveTags: ["summer", "tropical", "feel-good", "dance", "bright"],
      negativeTags: ["winter", "funeral", "dark ambient", "grief"],
      energy: 0.72, danceability: 0.72, preferredKnownness: 0.7,
      vocalPreference: "bright catchy vocal or tropical instrumental",
    },
  },
  {
    keywords: ["limpiar", "limpieza", "quehacer", "ordenar la casa"],
    profile: {
      occasion: "cleaning the house",
      moods: ["energetic", "happy", "motivated", "playful"],
      themes: ["momentum", "fun", "productivity"],
      positiveTags: ["upbeat", "dance", "singalong", "strong rhythm", "feel-good"],
      negativeTags: ["sleepy", "slow ambient", "funeral"],
      energy: 0.82, danceability: 0.82, preferredKnownness: 0.72,
      vocalPreference: "catchy familiar vocals",
    },
  },
  {
    keywords: ["cocinar", "cocinando", "cena con amigos", "dinner"],
    profile: {
      occasion: "cooking or casual dinner",
      moods: ["warm", "relaxed", "social", "pleasant"],
      themes: ["food", "friends", "conversation", "home"],
      positiveTags: ["groovy", "warm", "easy listening", "soul", "jazz", "soft pop"],
      negativeTags: ["aggressive", "funeral", "extremely loud"],
      energy: 0.48, danceability: 0.45, preferredKnownness: 0.55,
      vocalPreference: "pleasant vocals or tasteful instrumental",
    },
  },
  {
    keywords: ["videojuegos", "gaming", "jugar videojuegos", "jugar"],
    profile: {
      occasion: "gaming",
      moods: ["focused", "exciting", "immersive", "confident"],
      themes: ["challenge", "adventure", "victory", "momentum"],
      positiveTags: ["electronic", "cinematic", "energetic", "epic", "driving"],
      negativeTags: ["sleepy", "delicate ballad", "funeral"],
      energy: 0.78, danceability: 0.55, preferredKnownness: 0.5,
      vocalPreference: "instrumental or non-distracting energetic vocal",
    },
  },
  {
    keywords: ["epica", "epicas", "sentirme poderoso", "poderosa", "poderoso", "motivarme"],
    profile: {
      occasion: "empowerment",
      moods: ["powerful", "confident", "triumphant", "motivational"],
      themes: ["victory", "strength", "resilience", "ambition"],
      positiveTags: ["anthem", "epic", "powerful", "motivational", "big chorus"],
      negativeTags: ["defeated", "sleepy", "fragile", "background"],
      energy: 0.86, danceability: 0.55, preferredKnownness: 0.72,
      vocalPreference: "powerful lead vocal or epic instrumental",
    },
  },
  {
    keywords: ["nostalgia", "nostalgica", "nostalgicas", "recuerdos", "recordar"],
    profile: {
      occasion: "nostalgic listening",
      moods: ["nostalgic", "warm", "bittersweet", "reflective"],
      themes: ["memories", "youth", "past", "time", "friendship"],
      positiveTags: ["nostalgic", "throwback", "emotional", "timeless", "familiar"],
      negativeTags: ["futuristic experimental", "aggressive novelty"],
      energy: 0.5, danceability: 0.42, preferredKnownness: 0.82,
      vocalPreference: "familiar memorable vocal",
    },
  },
  {
    keywords: ["ninos", "ninas", "infantil", "familia con ninos", "kids"],
    profile: {
      occasion: "children and family",
      moods: ["happy", "playful", "safe", "bright"],
      themes: ["fun", "imagination", "friendship", "family"],
      positiveTags: ["children", "family-friendly", "playful", "singalong", "clean"],
      negativeTags: ["explicit", "sexual", "violent", "dark", "aggressive"],
      energy: 0.65, danceability: 0.65, preferredKnownness: 0.72,
      vocalPreference: "clear friendly vocals",
    },
  },
  {
    keywords: ["graduacion", "graduaciones"],
    profile: {
      occasion: "graduation",
      moods: ["celebratory", "nostalgic", "hopeful", "uplifting"],
      themes: ["achievement", "friendship", "memories", "new beginnings", "farewell"],
      positiveTags: ["anthem", "singalong", "inspirational", "emotional", "uplifting"],
      negativeTags: ["hopeless", "funeral", "aggressive", "romantic breakup"],
      energy: 0.7, danceability: 0.55, preferredKnownness: 0.85,
      vocalPreference: "memorable vocal chorus or ceremonial instrumental",
    },
  },
  {
    keywords: ["boda", "bodas", "casamiento", "matrimonio"],
    profile: {
      occasion: "wedding",
      moods: ["romantic", "joyful", "warm", "elegant"],
      themes: ["love", "commitment", "togetherness", "celebration"],
      positiveTags: ["romantic", "wedding", "love song", "elegant", "timeless"],
      negativeTags: ["breakup", "betrayal", "grief", "funeral"],
      energy: 0.55, danceability: 0.5, preferredKnownness: 0.75,
      vocalPreference: "romantic vocal or elegant instrumental",
    },
  },
  {
    keywords: ["funeral", "funerales", "velorio", "memorial"],
    profile: {
      occasion: "funeral",
      moods: ["solemn", "reflective", "sad", "comforting"],
      themes: ["memory", "loss", "farewell", "remembrance", "comfort"],
      positiveTags: ["memorial", "soft", "emotional", "reflective", "acoustic", "classical"],
      negativeTags: ["party", "upbeat", "dance", "aggressive", "comic"],
      energy: 0.12, danceability: 0.03, preferredKnownness: 0.65,
      vocalPreference: "soft vocal or instrumental",
    },
  },
  {
    keywords: ["gimnasio", "ejercicio", "entrenar", "entrenamiento", "correr"],
    profile: {
      occasion: "workout",
      moods: ["energetic", "motivational", "powerful", "confident"],
      themes: ["strength", "victory", "perseverance", "momentum"],
      positiveTags: ["workout", "high energy", "fast", "strong beat", "hype"],
      negativeTags: ["slow", "sleepy", "ambient", "delicate"],
      energy: 0.95, danceability: 0.75, preferredKnownness: 0.65,
      vocalPreference: "strong vocal or driving instrumental",
    },
  },
  {
    keywords: ["estudiar", "estudio", "concentracion", "concentrarme"],
    profile: {
      occasion: "studying",
      moods: ["calm", "focused", "steady", "unobtrusive"],
      themes: ["concentration", "clarity", "flow"],
      positiveTags: ["instrumental", "ambient", "lo-fi", "classical", "soft"],
      negativeTags: ["aggressive", "loud", "party", "dramatic", "singalong"],
      energy: 0.25, danceability: 0.1, preferredKnownness: 0.35,
      vocalPreference: "instrumental or minimal vocals",
    },
  },
  {
    keywords: ["carretera", "viaje", "manejar", "conducir", "road trip"],
    profile: {
      occasion: "road trip",
      moods: ["free", "adventurous", "nostalgic", "uplifting"],
      themes: ["travel", "freedom", "journey", "memories"],
      positiveTags: ["driving", "anthem", "singalong", "steady rhythm"],
      negativeTags: ["sleepy", "funeral", "extremely slow"],
      energy: 0.68, danceability: 0.5, preferredKnownness: 0.7,
      vocalPreference: "memorable vocals or cinematic instrumental",
    },
  },
  {
    keywords: ["karaoke"],
    profile: {
      occasion: "karaoke",
      moods: ["fun", "expressive", "communal", "energetic"],
      themes: ["singing together", "emotion", "performance"],
      positiveTags: ["singalong", "anthem", "memorable chorus", "popular"],
      negativeTags: ["instrumental", "ambient", "unknown", "complex experimental"],
      energy: 0.72, danceability: 0.55, preferredKnownness: 0.9,
      vocalPreference: "clear memorable lead vocal",
    },
  },
  {
    keywords: ["fiesta", "bailar", "baile", "antro", "club"],
    profile: {
      occasion: "dance party",
      moods: ["energetic", "joyful", "exciting", "confident"],
      themes: ["party", "movement", "celebration"],
      positiveTags: ["dance", "party", "upbeat", "disco", "electronic", "reggaeton"],
      negativeTags: ["ballad", "slow", "ambient", "funeral", "sleepy"],
      energy: 0.9, danceability: 0.95, preferredKnownness: 0.72,
      vocalPreference: "rhythmic vocal or dance instrumental",
    },
  },
];

function clamp(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 10)
    : [];
}

function applyModifiers(prompt: string, profile: ProfileTemplate): ProfileTemplate {
  const normalized = normalizeCatalogText(prompt);
  const result = structuredClone(profile);
  if (/\b(bailar|baile|fiesta|party)\b/.test(normalized)) {
    result.danceability = Math.max(result.danceability, 0.85);
    result.energy = Math.max(result.energy, 0.78);
    result.moods.push("energetic");
    result.positiveTags.push("dance", "party", "strong beat");
    if (result.occasion === "wedding") {
      result.occasion = "wedding reception dance party";
      result.moods = ["joyful", "celebratory", "energetic", "exciting"];
      result.themes = ["love", "togetherness", "celebration"];
      result.positiveTags = [
        "wedding reception", "dance floor", "upbeat", "party",
        "strong beat", "crowd-pleaser", "singalong",
      ];
      result.negativeTags = [
        "slow ballad", "ceremonial", "funeral", "breakup", "ambient",
      ];
      result.energy = 0.9;
      result.danceability = 0.95;
      result.vocalPreference = "rhythmic vocal with a famous energetic chorus";
    }
  }
  if (/\b(llorar|emotiva|emocional|sentimental)\b/.test(normalized)) {
    result.moods.push("emotional", "nostalgic");
    result.energy = Math.min(result.energy, 0.62);
    result.positiveTags.push("emotional");
  }
  if (/\b(ceremonia|ceremonial|entrada)\b/.test(normalized)) {
    result.energy = Math.min(result.energy, 0.4);
    result.danceability = Math.min(result.danceability, 0.2);
    result.moods.push("ceremonial", "elegant");
    result.positiveTags.push("ceremonial", "instrumental");
  }
  if (
    result.occasion === "road trip" &&
    /\b(noche|nocturno|nocturna|lluvia|lluvioso|lluviosa)\b/.test(normalized)
  ) {
    result.energy = Math.min(result.energy, 0.55);
    result.moods.push("atmospheric", "introspective", "cinematic");
    result.themes.push("night", "rain");
    result.positiveTags.push("night drive", "moody", "atmospheric");
  }
  result.moods = strings(result.moods);
  result.themes = strings(result.themes);
  result.positiveTags = strings(result.positiveTags);
  result.negativeTags = strings(result.negativeTags);
  return result;
}

async function interpretWithGemini(prompt: string): Promise<MusicIntentProfile | null> {
  if (!env.GEMINI_API_KEY) return null;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text:
            `Convierte esta petición musical en un perfil semántico, sin recomendar canciones: ${JSON.stringify(prompt)}. ` +
            "Deduce ocasión, emociones, temas, etiquetas ideales y contradictorias, energía, bailabilidad, " +
            "familiaridad deseada y preferencia vocal. Valores numéricos de 0 a 1." }],
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            required: [
              "occasion", "moods", "themes", "positiveTags", "negativeTags",
              "energy", "danceability", "preferredKnownness", "vocalPreference",
            ],
            properties: {
              occasion: { type: "string" },
              moods: { type: "array", items: { type: "string" } },
              themes: { type: "array", items: { type: "string" } },
              positiveTags: { type: "array", items: { type: "string" } },
              negativeTags: { type: "array", items: { type: "string" } },
              energy: { type: "number" },
              danceability: { type: "number" },
              preferredKnownness: { type: "number" },
              vocalPreference: { type: "string" },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) return null;
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  const parsed = JSON.parse(text) as Partial<ProfileTemplate>;
  return {
    occasion: String(parsed.occasion ?? "custom"),
    moods: strings(parsed.moods),
    themes: strings(parsed.themes),
    positiveTags: strings(parsed.positiveTags),
    negativeTags: strings(parsed.negativeTags),
    energy: clamp(parsed.energy, 0.5),
    danceability: clamp(parsed.danceability, 0.5),
    preferredKnownness: clamp(parsed.preferredKnownness, 0.5),
    vocalPreference: String(parsed.vocalPreference ?? "any"),
    source: "gemini",
  };
}

export async function interpretMusicIntent(prompt: string): Promise<MusicIntentProfile> {
  const normalized = normalizeCatalogText(prompt);
  const cached = intentCache.get(normalized);
  if (cached) return structuredClone(cached);
  const template = PROFILES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(normalizeCatalogText(keyword))));
  if (template) {
    const profile = { ...applyModifiers(prompt, template.profile), source: "local" as const };
    intentCache.set(normalized, profile);
    return structuredClone(profile);
  }
  try {
    const generated = await interpretWithGemini(prompt);
    if (generated) {
      intentCache.set(normalized, generated);
      return structuredClone(generated);
    }
  } catch (error) {
    console.warn(`[Música][Intención] Gemini falló: ${error instanceof Error ? error.message : String(error)}.`);
  }
  const fallback: MusicIntentProfile = {
    occasion: "custom",
    moods: [],
    themes: [],
    positiveTags: [prompt],
    negativeTags: [],
    energy: 0.5,
    danceability: 0.5,
    preferredKnownness: 0.5,
    vocalPreference: "any",
    source: "fallback",
  };
  intentCache.set(normalized, fallback);
  return structuredClone(fallback);
}

export function intentEmbeddingText(prompt: string, profile: MusicIntentProfile) {
  return [
    `Petición original: ${prompt}.`,
    `Ocasión: ${profile.occasion}.`,
    `Emociones ideales: ${profile.moods.join(", ")}.`,
    `Temas: ${profile.themes.join(", ")}.`,
    `Etiquetas compatibles: ${profile.positiveTags.join(", ")}.`,
    `Evitar: ${profile.negativeTags.join(", ")}.`,
    `Energía ${profile.energy.toFixed(2)}; bailabilidad ${profile.danceability.toFixed(2)}.`,
    `Preferencia vocal: ${profile.vocalPreference}.`,
  ].join(" ");
}

export function positiveIntentEmbeddingText(prompt: string, profile: MusicIntentProfile) {
  return [
    `Music request: ${prompt}.`,
    `Suitable for this occasion: ${profile.occasion}.`,
    `Desired moods: ${profile.moods.join(", ")}.`,
    `Desired themes: ${profile.themes.join(", ")}.`,
    `Desired musical qualities and tags: ${profile.positiveTags.join(", ")}.`,
    `Desired energy: ${profile.energy.toFixed(2)} out of 1.`,
    `Desired danceability: ${profile.danceability.toFixed(2)} out of 1.`,
    `Vocals: ${profile.vocalPreference}.`,
  ].join(" ");
}
