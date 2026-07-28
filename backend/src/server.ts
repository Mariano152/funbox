import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { registerRoomSocket } from "./realtime/room-socket.js";

const app = buildApp();
registerRoomSocket(app);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
