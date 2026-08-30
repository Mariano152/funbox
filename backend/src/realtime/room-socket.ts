import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { isAllowedOrigin } from "../config/cors.js";
import { roomEvents } from "../modules/rooms/rooms.events.js";
import { musicEvents } from "../modules/music/music.events.js";
import type { MusicPublicState } from "../modules/music/music.types.js";
import type { StoredRoom } from "../modules/rooms/rooms.repository.js";
import { triviaEvents } from "../modules/trivia/trivia.events.js";
import type { TriviaPublicState } from "../modules/trivia/trivia.types.js";

export function registerRoomSocket(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin));
      },
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    socket.on("room:watch", (code: string) => {
      if (/^[A-Z]{4}$/.test(code)) socket.join(`room:${code}`);
    });
  });

  roomEvents.on("room:updated", (room: StoredRoom) => {
    io.to(`room:${room.code}`).emit("room:updated", room);
  });
  musicEvents.on("music:updated", ({ code, state }: { code: string; state: MusicPublicState }) => {
    io.to(`room:${code}`).emit("music:updated", state);
  });
  triviaEvents.on("trivia:updated", ({ code, state }: { code: string; state: TriviaPublicState }) => {
    io.to(`room:${code}`).emit("trivia:updated", state);
  });

  return io;
}
