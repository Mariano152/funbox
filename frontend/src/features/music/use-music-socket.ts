"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";
import { API_URL } from "@/features/rooms/room.api";
import type { MusicPublicState } from "./music.api";

export function useMusicSocket(code: string, onUpdate: (state: MusicPublicState) => void) {
  useEffect(() => {
    const socket = io(API_URL, { transports: ["websocket", "polling"] });
    socket.emit("room:watch", code);
    socket.on("music:updated", onUpdate);
    return () => {
      socket.disconnect();
    };
  }, [code, onUpdate]);
}
