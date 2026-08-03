import type { FastifyPluginAsync } from "fastify";
import { roomsService } from "../services.js";
import { RoomsController } from "./rooms.controller.js";

const controller = new RoomsController(roomsService);

export const roomRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", controller.create);
  app.get("/:code", controller.findByCode);
  app.post("/:code/players", controller.join);
  app.patch("/:code/players/avatar", controller.changeAvatar);
  app.patch("/:code/players/dj", controller.changeDj);
  app.patch("/:code/music-config", controller.updateMusicConfig);
  app.post("/:code/start", controller.start);
};
