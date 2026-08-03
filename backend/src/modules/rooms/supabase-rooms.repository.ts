import type { DatabaseClient } from "../../database/client.js";
import type {
  AvatarColor,
  AvatarKey,
  GameConfig,
  RoomsRepository,
  StoredPlayer,
  StoredRoom,
} from "./rooms.repository.js";

interface RoomRow {
  id: string;
  code: string;
  current_game_key: string;
  game_state: GameConfig;
  status: StoredRoom["status"];
  created_at: Date;
}

interface PlayerRow {
  id: string;
  nickname: string;
  avatar_key: AvatarKey;
  avatar_color: AvatarColor;
  is_host: boolean;
  is_dj: boolean;
  is_connected: boolean;
}

export class SupabaseRoomsRepository implements RoomsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async create(room: StoredRoom, hostTokenHash: string) {
    await this.database`
      insert into public.rooms (
        id, code, status, current_game_key, game_state, host_token_hash, created_at
      )
      values (
        ${room.id}, ${room.code}, ${room.status}, ${room.gameKey},
        ${this.database.json(room.gameConfig)}, ${hostTokenHash}, ${room.createdAt}
      )
    `;
    return room;
  }

  async findByCode(code: string) {
    const [room] = await this.database<RoomRow[]>`
      select id, code, status, current_game_key, game_state, created_at
      from public.rooms where code = ${code} limit 1
    `;
    if (!room) return null;

    const players = await this.database<PlayerRow[]>`
      select id, nickname, avatar_key, avatar_color, is_host, is_dj, is_connected
      from public.room_players
      where room_id = ${room.id}
      order by joined_at asc
    `;
    return this.mapRoom(room, players);
  }

  async findPlayerByNickname(code: string, nickname: string) {
    const [player] = await this.database<PlayerRow[]>`
      select p.id, p.nickname, p.avatar_key, p.avatar_color, p.is_host, p.is_dj, p.is_connected
      from public.room_players p
      join public.rooms r on r.id = p.room_id
      where r.code = ${code} and lower(p.nickname) = lower(${nickname})
      limit 1
    `;
    return player ? this.mapPlayer(player) : null;
  }

  async addPlayer(code: string, player: StoredPlayer, reconnectTokenHash: string) {
    const [room] = await this.database<{ id: string }[]>`
      select id from public.rooms where code = ${code} and status = 'lobby' limit 1
    `;
    if (!room) return null;

    await this.database`
      insert into public.room_players (
        id, room_id, nickname, avatar_key, avatar_color,
        reconnect_token_hash, is_host, is_dj, is_connected
      )
      values (
        ${player.id}, ${room.id}, ${player.nickname}, ${player.avatarKey}, ${player.avatarColor},
        ${reconnectTokenHash}, ${player.isHost}, ${player.isDj}, ${player.isConnected}
      )
    `;
    return this.findByCode(code);
  }

  async reconnectPlayer(code: string, nickname: string, reconnectTokenHash: string) {
    const updated = await this.database`
      update public.room_players p
      set is_connected = true, last_seen_at = now()
      from public.rooms r
      where p.room_id = r.id
        and r.code = ${code}
        and lower(p.nickname) = lower(${nickname})
        and p.reconnect_token_hash = ${reconnectTokenHash}
      returning p.id
    `;
    return updated.count > 0 ? this.findByCode(code) : null;
  }

  async isPlayerTokenValid(code: string, playerId: string, reconnectTokenHash: string) {
    const [result] = await this.database<{ valid: boolean }[]>`
      select exists (
        select 1
        from public.room_players p
        join public.rooms r on r.id = p.room_id
        where r.code = ${code}
          and p.id = ${playerId}
          and p.reconnect_token_hash = ${reconnectTokenHash}
      ) as valid
    `;
    return result.valid;
  }

  async updateAvatar(
    code: string,
    playerId: string,
    avatarKey: AvatarKey,
    avatarColor: AvatarColor,
  ) {
    try {
      const updated = await this.database`
        update public.room_players p
        set avatar_key = ${avatarKey}, avatar_color = ${avatarColor}
        from public.rooms r
        where p.room_id = r.id
          and r.code = ${code}
          and p.id = ${playerId}
        returning p.id
      `;
      return updated.count > 0 ? this.findByCode(code) : null;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return null;
      }
      throw error;
    }
  }

  async updateDjRole(code: string, playerId: string, isDj: boolean) {
    try {
      const updated = await this.database`
        update public.room_players p
        set is_dj = ${isDj}
        from public.rooms r
        where p.room_id = r.id
          and r.code = ${code}
          and p.id = ${playerId}
        returning p.id
      `;
      return updated.count > 0 ? this.findByCode(code) : null;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        return null;
      }
      throw error;
    }
  }

  async assignHost(code: string, playerId?: string) {
    const [room] = await this.database<{ id: string }[]>`
      select id from public.rooms where code = ${code} limit 1
    `;
    if (!room) return null;

    await this.database.begin(async (transaction) => {
      await transaction`
        update public.room_players
        set is_host = false
        where room_id = ${room.id}
      `;
      if (playerId) {
        await transaction`
          update public.room_players
          set is_host = true
          where room_id = ${room.id} and id = ${playerId}
        `;
      }
    });
    return this.findByCode(code);
  }

  async updateGameConfig(code: string, gameConfig: GameConfig) {
    const updated = await this.database`
      update public.rooms
      set game_state = ${this.database.json(gameConfig)}
      where code = ${code} and status = 'lobby'
      returning id
    `;
    return updated.count > 0 ? this.findByCode(code) : null;
  }

  async updateStatus(code: string, status: StoredRoom["status"]) {
    const updated = await this.database`
      update public.rooms set status = ${status} where code = ${code} returning id
    `;
    return updated.count > 0 ? this.findByCode(code) : null;
  }

  private mapRoom(room: RoomRow, players: PlayerRow[]): StoredRoom {
    return {
      id: room.id,
      code: room.code,
      gameKey: room.current_game_key,
      gameConfig: room.game_state ?? {},
      status: room.status,
      createdAt: room.created_at.toISOString(),
      players: players.map((player) => this.mapPlayer(player)),
    };
  }

  private mapPlayer(player: PlayerRow): StoredPlayer {
    return {
      id: player.id,
      nickname: player.nickname,
      avatarKey: player.avatar_key,
      avatarColor: player.avatar_color,
      isHost: player.is_host,
      isDj: player.is_dj,
      isConnected: player.is_connected,
    };
  }
}
