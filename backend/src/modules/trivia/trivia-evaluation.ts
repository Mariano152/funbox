import { generateTriviaQuestions } from "./trivia.service.js";
import type { TriviaConfig } from "./trivia.types.js";

const scenarios: Array<{ name: string; config: TriviaConfig }> = [
  { name: "cultura-general-cinco-niveles", config: { mode: "categories", categories: [], topic: "Cultura general variada; evita preguntas de capitales y autores de obras demasiado famosas", difficulties: ["very_easy", "easy", "medium", "hard", "very_hard"], rounds: 5, answerDuration: 20 } },
  { name: "arte-newton-interseccion", config: { mode: "categories", categories: ["art_literature"], topic: "Relaciona las preguntas, cuando sea factual y natural, con Isaac Newton, su época, óptica, representación visual o legado; no fuerces conexiones falsas", difficulties: ["medium", "hard", "very_hard"], rounds: 5, answerDuration: 20 } },
  { name: "ultra-especifico-voyager", config: { mode: "custom", categories: [], topic: "Instrumentación científica de las sondas Voyager 1 y 2: detectores, rangos de medición, responsables institucionales y resultados concretos en los encuentros planetarios; excluye fechas de lanzamiento y la pregunta de cuál está más lejos", difficulties: ["hard", "very_hard"], rounds: 5, answerDuration: 30 } },
];

for (const scenario of scenarios) {
  const startedAt = Date.now();
  try {
    const questions = await generateTriviaQuestions(scenario.config);
    console.log(JSON.stringify({ scenario: scenario.name, elapsedMs: Date.now() - startedAt, questions }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ scenario: scenario.name, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }));
  }
}
