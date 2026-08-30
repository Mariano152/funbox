import cors from "@fastify/cors";
import Fastify from "fastify";
import { isAllowedOrigin } from "./config/cors.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { musicRoutes } from "./modules/music/music.routes.js";
import { roomRoutes } from "./modules/rooms/rooms.routes.js";
import { triviaRoutes } from "./modules/trivia/trivia.routes.js";

export function buildApp() {
  const app = Fastify({
    logger: {
      level: "error",
    },
  });

  app.register(cors, {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  });

  app.register(healthRoutes, { prefix: "/api/health" });
  app.register(musicRoutes, { prefix: "/api/music" });
  app.register(roomRoutes, { prefix: "/api/rooms" });
  app.register(triviaRoutes, { prefix: "/api/trivia" });

  return app;
}
