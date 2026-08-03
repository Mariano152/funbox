import type { DatabaseClient } from "../../database/client.js";
import type { SecretTrack } from "./music.types.js";

export class MusicHistoryRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findRecent(limit = 100): Promise<SecretTrack[]> {
    const rows = await this.database<{ title: string; artist: string }[]>`
      select title, artist
      from public.music_track_history
      where selected_at >= now() - interval '30 days'
      order by selected_at desc
      limit ${limit}
    `;
    return rows;
  }

  async add(roomId: string, category: string, track: SecretTrack) {
    await this.database`
      insert into public.music_track_history (room_id, category, title, artist)
      values (${roomId}, ${category}, ${track.title}, ${track.artist})
    `;
  }
}
