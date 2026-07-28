"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL } from "./room.api";
import type { Room } from "./room.types";

export function useRoomSocket(code: string, onRoomUpdated: (room: Room) => void) {
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket", "polling"] });
    socket.emit("room:watch", code);
    socket.on("room:updated", onRoomUpdated);
    return () => {
      socket.disconnect();
    };
  }, [code, onRoomUpdated]);
}
