export const MUSIC_GENRES = [
  "Pop", "Rock", "Reggaetón", "Hip hop", "Rap", "R&B", "Electrónica",
  "Dance", "Indie", "Alternativa", "Country", "Metal", "Punk", "Funk",
  "Disco", "Soul", "Jazz", "Blues", "Salsa", "Cumbia", "Bachata",
  "Regional mexicano", "K-pop", "J-pop", "Afrobeats", "Reggae",
  "Latina",
] as const;

export const CLIP_DURATIONS = [10, 15, 20, 30] as const;
export const ANSWER_DURATIONS = [15, 30, 45, 60] as const;
export const ROUND_COUNTS = [5, 10, 15, 20] as const;
export const MUSIC_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "international", label: "Internacional y multilingüe" },
] as const;

export type ClipDuration = (typeof CLIP_DURATIONS)[number];
export type RoundCount = (typeof ROUND_COUNTS)[number];
export type MusicPlaybackMode = "youtube" | "demo" | "manual" | "reactional";
export type MusicLanguage = (typeof MUSIC_LANGUAGES)[number]["value"];
export type MusicDifficulty = "easy" | "medium" | "hard";

export interface MusicGameConfig {
  genres: string[];
  languages: MusicLanguage[];
  yearFrom: number;
  yearTo: number;
  artists: string[];
  difficulties: MusicDifficulty[];
  clipDuration: ClipDuration;
  answerDuration: number;
  rounds: RoundCount;
  playbackMode: MusicPlaybackMode;
  prompt: string;
}

export const DEFAULT_MUSIC_CONFIG: MusicGameConfig = {
  genres: [],
  languages: [],
  yearFrom: 1980,
  yearTo: new Date().getFullYear(),
  artists: [],
  difficulties: [],
  clipDuration: 20,
  answerDuration: 30,
  rounds: 10,
  playbackMode: "youtube",
  prompt: "",
};
