import type { FastifyPluginAsync } from "fastify";
import { TriviaController } from "./trivia.controller.js";
const controller = new TriviaController();
export const triviaRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:code/state", controller.state); app.post("/:code/next", controller.next);
  app.post("/:code/reveal", controller.reveal); app.post("/:code/answers", controller.answer);
  app.post("/:code/replay", controller.replay);
  app.patch("/:code/pause", controller.pause);
};
