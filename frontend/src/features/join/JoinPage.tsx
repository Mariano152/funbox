"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { joinRoom, sessionKey } from "@/features/rooms/room.api";
import type { PlayerSession } from "@/features/rooms/room.types";

export function JoinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code")?.toUpperCase().slice(0, 4) ?? "");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const key = sessionKey(code, name);
      const previousSession = localStorage.getItem(key);
      const previousToken = previousSession
        ? (JSON.parse(previousSession) as PlayerSession).reconnectToken
        : undefined;
      const result = await joinRoom(code, name, previousToken);
      const session: PlayerSession = {
        code,
        playerId: result.player.id,
        nickname: result.player.nickname,
        reconnectToken: result.reconnectToken,
      };
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem(`funbox:active:${code}`, JSON.stringify(session));
      router.push(`/room/${code}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos entrar");
      setLoading(false);
    }
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <Link href="/" className="mini-logo">FUNBOX</Link>
        <div>
          <p className="phone-eyebrow">La fiesta empieza aquí</p>
          <h1>Únete a una sala</h1>
          <p>Escribe el código de la televisión y el nombre que usarás en la fiesta.</p>
        </div>
        <form onSubmit={join} className="join-form">
          <label htmlFor="room-code">Código de sala</label>
          <input
            id="room-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
            placeholder="MOCO"
            autoComplete="off"
          />
          <label htmlFor="nickname">Tu nametag</label>
          <input
            id="nickname"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 16))}
            placeholder="¿Cómo te llamamos?"
            autoComplete="nickname"
          />
          <button disabled={loading || code.length !== 4 || !name.trim()}>
            {loading ? "Entrando…" : "Entrar a la fiesta"} <span>→</span>
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
        <small>Este dispositivo recordará tu gelatina para que puedas reconectarte.</small>
      </section>
    </main>
  );
}
