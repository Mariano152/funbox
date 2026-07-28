import cors from "@fastify/cors";
import Fastify from "fastify";
import { isAllowedOrigin } from "./config/cors.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { roomRoutes } from "./modules/rooms/rooms.routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  });

  app.register(healthRoutes, { prefix: "/api/health" });
  app.register(roomRoutes, { prefix: "/api/rooms" });

  return app;
}
