import type { FastifyPluginAsync } from "fastify";
import { musicService } from "../services.js";
import { MusicController } from "./music.controller.js";

const controller = new MusicController(musicService);

export const musicRoutes: FastifyPluginAsync = async (app) => {
  app.post("/:code/dj/connect", controller.connectDj);
  app.get("/:code/state", controller.getState);
  app.get("/suggestions", controller.suggestions);
  app.post("/:code/answers", controller.answer);
  app.put("/:code/answers/draft", controller.draft);
  app.post("/:code/rounds/prepare", controller.prepare);
  app.post("/:code/rounds/manual", controller.manual);
  app.post("/:code/rounds/started", controller.started);
  app.post("/:code/rounds/finish-clip", controller.finishClip);
  app.post("/:code/rounds/reveal", controller.reveal);
  app.patch("/:code/pause", controller.pause);
  app.post("/:code/return-to-lobby", controller.returnToLobby);
};
