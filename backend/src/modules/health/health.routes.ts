import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({
    status: "ok",
    service: "funbox-backend",
    timestamp: new Date().toISOString(),
  }));
};
