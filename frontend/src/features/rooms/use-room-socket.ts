"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL, getRoom } from "./room.api";
import type { Room } from "./room.types";

export function useRoomSocket(code: string, onRoomUpdated: (room: Room) => void) {
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket", "polling"] });
    const refreshRoom = () => {
      getRoom(code).then(onRoomUpdated).catch(() => undefined);
    };
    const watchRoom = () => {
      socket.emit("room:watch", code);
      refreshRoom();
    };
    socket.on("connect", watchRoom);
    socket.on("room:updated", onRoomUpdated);
    const reconciliation = window.setInterval(refreshRoom, 5_000);
    return () => {
      window.clearInterval(reconciliation);
      socket.disconnect();
    };
  }, [code, onRoomUpdated]);
}
