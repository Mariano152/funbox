import { createDatabaseClient } from "../database/client.js";
import { MusicCatalogRepository } from "./music/music-catalog.repository.js";
import { MusicHistoryRepository } from "./music/music-history.repository.js";
import { MusicStateRepository } from "./music/music-state.repository.js";
import { MusicService } from "./music/music.service.js";
import { RoomsService } from "./rooms/rooms.service.js";
import { SupabaseRoomsRepository } from "./rooms/supabase-rooms.repository.js";

const database = createDatabaseClient();
export const roomsRepository = new SupabaseRoomsRepository(database);
export const musicCatalogRepository = new MusicCatalogRepository(database);
export const musicHistoryRepository = new MusicHistoryRepository(database);
export const musicStateRepository = new MusicStateRepository(database);
export const musicService = new MusicService(
  roomsRepository, musicHistoryRepository, musicCatalogRepository, musicStateRepository,
);
export const roomsService = new RoomsService(roomsRepository, musicService);
