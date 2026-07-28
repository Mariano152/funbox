import type { FastifyPluginAsync } from "fastify";
import { createDatabaseClient } from "../../database/client.js";
import { RoomsController } from "./rooms.controller.js";
import { RoomsService } from "./rooms.service.js";
import { SupabaseRoomsRepository } from "./supabase-rooms.repository.js";

const repository = new SupabaseRoomsRepository(createDatabaseClient());
const service = new RoomsService(repository);
const controller = new RoomsController(service);

export const roomRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", controller.create);
  app.get("/:code", controller.findByCode);
  app.post("/:code/players", controller.join);
  app.patch("/:code/players/avatar", controller.changeAvatar);
  app.post("/:code/start", controller.start);
};
