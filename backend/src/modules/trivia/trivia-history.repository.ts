import type { DatabaseClient } from "../../database/client.js";
import type { TriviaQuestion } from "./trivia.types.js";

export interface TriviaHistoryEntry { entityKey: string; factKey: string; question: string }

export class TriviaHistoryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(roomId: string, limit = 500) {
    const rows = await this.database<{ entity_key: string; fact_key: string; question_text: string }[]>`
      select entity_key, fact_key, question_text
      from public.trivia_question_history
      where room_id = ${roomId}
      order by created_at desc
      limit ${limit}
    `;
    return rows.map((row) => ({ entityKey: row.entity_key, factKey: row.fact_key, question: row.question_text }));
  }

  async save(roomId: string, questions: TriviaQuestion[]) {
    if (!questions.length) return;
    await this.database`
      insert into public.trivia_question_history ${this.database(questions.map((question) => ({
        room_id: roomId, entity_key: question.entityKey, fact_key: question.factKey,
        question_text: question.question, category: question.category, difficulty: question.difficulty,
        source_title: question.sourceTitle, source_url: question.sourceUrl,
      })))}
      on conflict (room_id, entity_key, fact_key) do nothing
    `;
  }
}
