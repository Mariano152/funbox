"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import { MusicConfigFields } from "@/features/music/MusicConfigFields";
import { DEFAULT_MUSIC_CONFIG, type MusicGameConfig } from "@/features/music/music.types";
import { createRoom } from "@/features/rooms/room.api";
import type { GameDefinition } from "./game-catalog";
import { FunboxLogo } from "./FunboxLogo";

export function GameSetupPage({ game }: { game: GameDefinition }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [musicConfig, setMusicConfig] = useState<MusicGameConfig>(DEFAULT_MUSIC_CONFIG);
  const isMusicGame = game.key === "guess-the-song";

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      const { room } = await createRoom(game.key, isMusicGame ? musicConfig : {});
      router.push(`/host/${room.code}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear la sala");
      setLoading(false);
    }
  }

  return (
    <main className={`setup-shell setup-${game.accent}`}>
      <header className="setup-header"><FunboxLogo /><Link href="/games">← Todos los juegos</Link></header>
      <section className="setup-card">
        <div className="setup-visual">
          <span className="setup-badge">{game.category}</span>
          <div className="setup-icon" aria-hidden="true">{game.icon}</div>
          <div className="setup-jellies">
            <AvatarCharacter avatarKey="nerd" compact />
            <AvatarCharacter avatarKey="athlete" index={1} compact />
            <AvatarCharacter avatarKey="artist" index={2} compact />
          </div>
        </div>
        <div className="setup-copy">
          <p className="eyebrow">Juego seleccionado</p>
          <h1>{game.name}</h1>
          <p>{game.description}</p>
          <div className="setup-meta"><span><strong>{game.players}</strong> jugadores</span><span><strong>{game.duration}</strong> por partida</span></div>
          {isMusicGame && (
            <div className="music-config">
              <MusicConfigFields value={musicConfig} onChange={setMusicConfig} />
            </div>
          )}
          <div className="setup-flow"><span>1. Crea la sala</span><span>2. Entran tus amigos</span><span>3. Empieza el juego</span></div>
          <button className="start-button setup-button" onClick={handleCreate} disabled={loading}>
            <span>{loading ? "Preparando música y lobby…" : "Confirmar y crear lobby"}</span><i>→</i>
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}
