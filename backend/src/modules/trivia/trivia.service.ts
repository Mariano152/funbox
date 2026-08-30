import { randomUUID, createHash } from "node:crypto";
import { env } from "../../config/env.js";
import type { GameConfig, RoomsRepository } from "../rooms/rooms.repository.js";
import { publishRoomUpdated } from "../rooms/rooms.events.js";
import { publishTriviaUpdated } from "./trivia.events.js";
import type { TriviaHistoryEntry, TriviaHistoryRepository } from "./trivia-history.repository.js";
import type { TriviaConfig, TriviaDifficulty, TriviaQuestion, TriviaRuntime } from "./trivia.types.js";

const games = new Map<string, TriviaRuntime>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const REVEAL_DURATION_MS = 6_000;
const ALL_DIFFICULTIES: TriviaDifficulty[] = ["very_easy", "easy", "medium", "hard", "very_hard"];
const ALL_CATEGORIES: TriviaConfig["categories"] = ["history", "geography", "science", "math_logic", "language", "art_literature", "film_tv", "music", "sports", "technology", "pop_culture", "mexico"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const configFrom = (value: GameConfig): TriviaConfig => ({
  mode: value.mode === "custom" ? "custom" : "categories",
  categories: Array.isArray(value.categories) ? value.categories.filter((item): item is TriviaConfig["categories"][number] => ALL_CATEGORIES.includes(item as never)) : [],
  topic: String(value.topic ?? "Cultura general"),
  difficulties: Array.isArray(value.difficulties) && value.difficulties.length ? value.difficulties.filter((item): item is TriviaDifficulty => ALL_DIFFICULTIES.includes(item as TriviaDifficulty)) : ALL_DIFFICULTIES.includes(value.difficulty as TriviaDifficulty) ? [value.difficulty as TriviaDifficulty] : [],
  rounds: Number(value.rounds ?? 10), answerDuration: Number(value.answerDuration ?? 20),
});

type FactCard = { slot: number; entityKey: string; factKey: string; category: string; claim: string; answer: string; sourceTitle: string; sourceUrl: string; sourceEvidence: string; difficulty: TriviaDifficulty };
type GeneratedQuestion = Omit<TriviaQuestion, "id">;
const factSchema = (count: number) => ({ type: "OBJECT", properties: { facts: { type: "ARRAY", minItems: count, maxItems: count, items: { type: "OBJECT", properties: { slot: { type: "INTEGER" }, entityKey: { type: "STRING" }, factKey: { type: "STRING" }, category: { type: "STRING" }, claim: { type: "STRING" }, answer: { type: "STRING" }, sourceTitle: { type: "STRING" }, sourceUrl: { type: "STRING" }, sourceEvidence: { type: "STRING" }, difficulty: { type: "STRING", enum: ALL_DIFFICULTIES } }, required: ["slot", "entityKey", "factKey", "category", "claim", "answer", "sourceTitle", "sourceUrl", "sourceEvidence", "difficulty"] } } }, required: ["facts"] });
const questionSchema = (count: number) => ({ type: "OBJECT", properties: { questions: { type: "ARRAY", minItems: count, maxItems: count, items: { type: "OBJECT", properties: { question: { type: "STRING" }, options: { type: "ARRAY", minItems: 4, maxItems: 4, items: { type: "STRING" } }, correctIndex: { type: "INTEGER", minimum: 0, maximum: 3 }, explanation: { type: "STRING" }, difficulty: { type: "STRING", enum: ALL_DIFFICULTIES }, category: { type: "STRING" }, entityKey: { type: "STRING" }, factKey: { type: "STRING" }, sourceTitle: { type: "STRING" }, sourceUrl: { type: "STRING" } }, required: ["question", "options", "correctIndex", "explanation", "difficulty", "category", "entityKey", "factKey", "sourceTitle", "sourceUrl"] } } }, required: ["questions"] });

async function askGemini<T>(prompt: string, schema: object, useSearch = false) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], ...(useSearch ? { tools: [{ google_search: {} }] } : {}), generationConfig: { temperature: 0.65, maxOutputTokens: 10_000, responseMimeType: "application/json", responseSchema: schema } }) });
  if (!response.ok) {
    const detail = await response.text();
    let reason = "";
    try { reason = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? ""; } catch { reason = detail.slice(0, 300); }
    throw fail(`Gemini no pudo preparar la trivia (${response.status})${reason ? `: ${reason}` : ""}`, 503);
  }
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}") as T;
}

function shuffled<T>(input: T[]) { const values = [...input]; for (let index = values.length - 1; index > 0; index -= 1) { const target = Math.floor(Math.random() * (index + 1)); [values[index], values[target]] = [values[target], values[index]]; } return values; }
function counts(plan: TriviaDifficulty[]) { return plan.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {}); }

function validateQuestions(input: GeneratedQuestion[], config: TriviaConfig, excluded: TriviaHistoryEntry[], plan: TriviaDifficulty[], facts: FactCard[]) {
  const forbiddenQuestions = new Set(excluded.map((item) => normalize(item.question)));
  const forbiddenFacts = new Set(excluded.map((item) => `${normalize(item.entityKey)}::${normalize(item.factKey)}`));
  const factKeys = new Set(facts.map((item) => `${normalize(item.entityKey)}::${normalize(item.factKey)}`));
  const seen = new Set<string>(); const allowed = config.difficulties.length ? config.difficulties : ALL_DIFFICULTIES;
  const valid = input.filter((question) => {
    const text = normalize(question.question ?? ""); const identity = `${normalize(question.entityKey ?? "")}::${normalize(question.factKey ?? "")}`; const options = question.options?.map(normalize) ?? [];
    if (!text || forbiddenQuestions.has(text) || forbiddenFacts.has(identity) || !factKeys.has(identity) || seen.has(identity) || options.length !== 4 || new Set(options).size !== 4 || options.some((option) => !option) || !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3 || !question.explanation?.trim() || !allowed.includes(question.difficulty) || !/^https?:\/\//.test(question.sourceUrl)) return false;
    seen.add(identity); return true;
  }).slice(0, config.rounds);
  const expected = counts(plan); const actual = counts(valid.map((question) => question.difficulty));
  return Object.entries(expected).every(([difficulty, count]) => actual[difficulty] === count) ? valid : [];
}

export async function generateTriviaQuestions(config: TriviaConfig, excluded: TriviaHistoryEntry[] = []) {
  if (!env.GEMINI_API_KEY) throw fail("Falta configurar GEMINI_API_KEY para generar la trivia", 503);
  const selected = config.difficulties.length ? config.difficulties : ALL_DIFFICULTIES;
  const difficultyPlan = Array.from({ length: config.rounds }, () => selected[Math.floor(Math.random() * selected.length)]);
  const categoryPool = config.categories.length ? config.categories : ALL_CATEGORIES;
  const categoryPlan = Array.from({ length: config.rounds }, () => categoryPool[Math.floor(Math.random() * categoryPool.length)]);
  const slots = difficultyPlan.map((difficulty, index) => ({ slot: index + 1, difficulty, category: config.mode === "categories" ? categoryPlan[index] : "auto" }));
  const scope = config.mode === "custom" ? `Tema personalizado obligatorio: ${config.topic}. Detecta sus subáreas naturales; no fuerces categorías incompatibles.` : `Respeta la categoría sorteada en cada slot. Instrucciones opcionales del anfitrión: ${config.topic}.`;
  const history = excluded.slice(0, 500).map((item) => `${item.entityKey}::${item.factKey}`).join(" | ") || "ninguno";
  const rubric = "Calibración: very_easy=hecho universal y directo, 85-98% de acierto esperado; easy=conocimiento común, 65-85%; medium=conocimiento específico o inferencia de un paso, 35-65%; hard=detalle no obvio o relación de dos pasos, 15-35%; very_hard=detalle especializado pero justo y verificable, 5-15%. En hard y very_hard quedan prohibidos hechos escolares famosos disfrazados con redacción complicada.";
  const research = await askGemini<{ facts?: FactCard[] }>(`Eres investigador de un juego de trivia en español mexicano. Investiga en la web y crea exactamente una ficha factual por slot. ${scope} ${rubric} Plan: ${JSON.stringify(slots)}. Usa fuentes abiertas: prioriza fuentes primarias, instituciones, enciclopedias reputadas y documentación especializada, pero NO te limites a una lista fija ni a un solo dominio; busca la mejor fuente concreta para cada hecho. sourceUrl debe respaldar claim y answer. entityKey identifica establemente el objeto, persona o evento; factKey identifica el atributo o relación preguntado. No reutilices: ${history}. Diversifica entidades, épocas y tipos de conocimiento. No redactes todavía la pregunta. Semilla: ${randomUUID()}.`, factSchema(config.rounds), true);
  const facts = research.facts ?? [];
  if (facts.length !== config.rounds) throw fail("Gemini no produjo suficientes fichas verificables", 503);
  const edited = await askGemini<{ questions?: GeneratedQuestion[] }>(`Eres editor y verificador adversarial de trivia. Convierte cada ficha en exactamente una pregunta de opción múltiple en español mexicano. Trabaja sólo con el hecho y evidencia de su ficha; revisa dos veces que correctIndex sea correcto, que haya una sola respuesta defendible y que los tres distractores sean plausibles, homogéneos y falsos. ${rubric} Mantén difficulty, category, entityKey, factKey, sourceTitle y sourceUrl. Evita pistas gramaticales, fechas sin contexto, “todas/ninguna”, negaciones tramposas y opciones solapadas. Explica brevemente la respuesta. Fichas: ${JSON.stringify(facts)}.`, questionSchema(config.rounds));
  const questions = validateQuestions(edited.questions ?? [], config, excluded, difficultyPlan, facts);
  if (questions.length < config.rounds) throw fail("La revisión no produjo suficientes preguntas inequívocas", 503);
  return shuffled(questions).map((question) => ({ ...question, id: randomUUID() }));
}

export class TriviaService {
  constructor(private rooms: RoomsRepository, private history: TriviaHistoryRepository) {}
  private clearTimer(code: string) { const timer = timers.get(code); if (timer) clearTimeout(timer); timers.delete(code); }
  private schedule(code: string, milliseconds: number, action: () => Promise<unknown>) { this.clearTimer(code); timers.set(code, setTimeout(() => { timers.delete(code); void action().catch((error) => console.error(`[Trivia ${code}]`, error)); }, milliseconds)); }
  async prepareLobbyPlaylist(code: string, raw: GameConfig) { await this.prepare(code, raw); }
  async isLobbyPlaylistPrepared(code: string, raw: GameConfig) { const game = games.get(code); return Boolean(game && JSON.stringify(game.config) === JSON.stringify(configFrom(raw))); }
  async clearLobbyPlaylist(code: string) { this.clearTimer(code); games.delete(code); }
  async prepare(code: string, raw: GameConfig) {
    this.clearTimer(code); const room = await this.rooms.findByCode(code); if (!room) throw fail("Sala no encontrada", 404);
    const previous = games.get(code); const persisted = await this.history.list(room.id);
    const transient = previous?.questions.map((question) => ({ entityKey: question.entityKey, factKey: question.factKey, question: question.question })) ?? [];
    const config = configFrom(raw); const questions = await generateTriviaQuestions(config, [...transient, ...persisted]);
    await this.history.save(room.id, questions);
    games.set(code, { config, questions, index: -1, usedQuestions: [...transient, ...persisted].map((item) => item.question), state: { phase: "ready", roundNumber: 0, totalRounds: config.rounds, answerDuration: config.answerDuration, answers: {}, scores: {} } });
  }
  state(code: string) { const game = games.get(code); if (!game) throw fail("La trivia no está preparada", 404); return game.state; }
  async onRoomStarted(code: string) { const game = games.get(code); if (!game) throw fail("La trivia no está preparada", 404); if (game.state.phase === "ready") await this.next(code); }
  async next(code: string) { const game = games.get(code); if (!game) throw fail("La trivia no está preparada", 404); if (!["ready", "reveal"].includes(game.state.phase)) return game.state; game.index += 1; if (game.index >= game.questions.length) game.state = { ...game.state, phase: "finished", question: undefined, correctIndex: undefined, explanation: undefined, deadlineAt: undefined }; else { const q = game.questions[game.index]; game.state = { ...game.state, phase: "question", roundNumber: game.index + 1, question: { id: q.id, question: q.question, options: q.options, difficulty: q.difficulty }, answers: {}, correctIndex: undefined, explanation: undefined, deadlineAt: new Date(Date.now() + game.config.answerDuration * 1000).toISOString() }; } publishTriviaUpdated(code, game.state); if (game.state.phase === "question") this.schedule(code, game.config.answerDuration * 1000, () => this.reveal(code)); return game.state; }
  async reveal(code: string) { const game = games.get(code); const q = game?.questions[game.index]; if (!game || !q) throw fail("No hay pregunta activa", 409); if (game.state.phase !== "question") return game.state; for (const [playerId, option] of Object.entries(game.state.answers)) if (option === q.correctIndex) game.state.scores[playerId] = (game.state.scores[playerId] ?? 0) + 1; game.state = { ...game.state, phase: "reveal", correctIndex: q.correctIndex, explanation: q.explanation, deadlineAt: new Date(Date.now() + REVEAL_DURATION_MS).toISOString() }; publishTriviaUpdated(code, game.state); this.schedule(code, REVEAL_DURATION_MS, () => this.next(code)); return game.state; }
  async setPaused(code: string, paused: boolean) { const game = games.get(code); if (!game) throw fail("La trivia no está preparada", 404); if (paused) { if (!["question", "reveal"].includes(game.state.phase)) return game.state; const phase = game.state.phase as "question" | "reveal"; const remaining = game.state.deadlineAt ? Math.max(0, new Date(game.state.deadlineAt).getTime() - Date.now()) : 1000; this.clearTimer(code); game.state = { ...game.state, phase: "paused", pausedPhase: phase, pausedRemainingMs: remaining, deadlineAt: undefined }; } else { if (game.state.phase !== "paused" || !game.state.pausedPhase) return game.state; const phase = game.state.pausedPhase; const remaining = Math.max(250, game.state.pausedRemainingMs ?? 1000); game.state = { ...game.state, phase, deadlineAt: phase === "question" ? new Date(Date.now() + remaining).toISOString() : undefined, pausedPhase: undefined, pausedRemainingMs: undefined }; this.schedule(code, remaining, () => phase === "question" ? this.reveal(code) : this.next(code)); } publishTriviaUpdated(code, game.state); return game.state; }
  async answer(code: string, playerId: string, token: string, optionIndex: number) { const game = games.get(code); if (!game || game.state.phase !== "question") throw fail("Ahora no se puede responder", 409); if (!await this.rooms.isPlayerTokenValid(code, playerId, hash(token))) throw fail("Sesión no válida", 401); if (game.state.answers[playerId] === undefined) game.state.answers[playerId] = optionIndex; publishTriviaUpdated(code, game.state); return game.state; }
  async replay(code: string) { const room = await this.rooms.findByCode(code); const old = games.get(code); if (!room || !old) throw fail("Sala no encontrada", 404); await this.prepare(code, room.gameConfig); const updated = await this.rooms.updateStatus(code, "lobby"); if (!updated) throw fail("Sala no encontrada", 404); publishRoomUpdated(updated); return updated; }
}
