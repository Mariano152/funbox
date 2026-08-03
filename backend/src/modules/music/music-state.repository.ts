import type { DatabaseClient } from "../../database/client.js";
import type { MusicRoomState } from "./music.types.js";

export class MusicStateRepository {
  constructor(private readonly database: DatabaseClient) {}

  async find(code: string): Promise<MusicRoomState | undefined> {
    const [row] = await this.database<Array<{ state: MusicRoomState }>>`
      select state
      from public.music_room_runtime_states
      where room_code = ${code}
      limit 1
    `;
    return row?.state;
  }

  async save(code: string, state: MusicRoomState) {
    const serializedState = JSON.parse(JSON.stringify(state));
    await this.database`
      insert into public.music_room_runtime_states (room_code, state, updated_at)
      values (${code}, ${this.database.json(serializedState)}, now())
      on conflict (room_code) do update set
        state = excluded.state,
        updated_at = now()
    `;
  }

  async delete(code: string) {
    await this.database`
      delete from public.music_room_runtime_states where room_code = ${code}
    `;
  }
}
