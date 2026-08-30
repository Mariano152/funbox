export type TriviaDifficulty = "very_easy" | "easy" | "medium" | "hard" | "very_hard";
export type TriviaMode = "categories" | "custom";
export type TriviaCategory = "history" | "geography" | "science" | "math_logic" | "language" | "art_literature" | "film_tv" | "music" | "sports" | "technology" | "pop_culture" | "mexico";
export interface TriviaConfig { mode: TriviaMode; categories: TriviaCategory[]; topic: string; difficulties: TriviaDifficulty[]; rounds: number; answerDuration: number }
export interface TriviaQuestion { id: string; question: string; options: string[]; correctIndex: number; explanation: string; difficulty: TriviaDifficulty; category: string; entityKey: string; factKey: string; sourceTitle: string; sourceUrl: string }
export interface TriviaPublicState {
  phase: "ready" | "question" | "reveal" | "paused" | "finished";
  roundNumber: number; totalRounds: number; answerDuration: number; deadlineAt?: string;
  question?: Pick<TriviaQuestion, "id" | "question" | "options" | "difficulty">;
  correctIndex?: number; explanation?: string;
  answers: Record<string, number>; scores: Record<string, number>;
  pausedPhase?: "question" | "reveal"; pausedRemainingMs?: number;
}
export interface TriviaRuntime { config: TriviaConfig; questions: TriviaQuestion[]; index: number; usedQuestions: string[]; state: TriviaPublicState }
