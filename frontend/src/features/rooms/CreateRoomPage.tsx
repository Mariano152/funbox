"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AvatarCharacter, AVATAR_CATALOG } from "@/features/avatars/avatar-catalog";
import { createRoom } from "./room.api";

export function CreateRoomPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    setError("");
    try {
      const { room } = await createRoom();
      router.push(`/host/${room.code}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos crear la sala");
      setLoading(false);
    }
  }

  return (
    <main className="create-shell">
      <section className="create-card">
        <div className="party-scene" aria-label="Ocho personajes de Funbox celebrando">
          <div className="party-confetti" />
          {AVATAR_CATALOG.slice(0, 8).map((avatar, index) => (
            <div className={`party-character party-character-${index + 1}`} key={avatar.key}>
              <AvatarCharacter avatarKey={avatar.key} index={index} compact />
            </div>
          ))}
        </div>
        <div className="funbox-logo create-logo" aria-label="Funbox">
          <span className="logo-pink">F</span><span className="logo-purple">U</span>
          <span className="logo-cyan">N</span><span className="logo-pink">B</span>
          <span className="logo-purple logo-face">O</span><span className="logo-lime">X</span>
        </div>
        <p className="eyebrow create-eyebrow">La fiesta empieza aquí</p>
        <h1>Que empiece<br />el desorden.</h1>
        <p className="create-copy">
          Crea una sala, muestra el código en la TV y deja que todos entren desde su celular.
        </p>
        <button className="start-button create-button" onClick={handleCreate} disabled={loading}>
          <span>{loading ? "Creando sala…" : "Crear una sala"}</span><i>→</i>
        </button>
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
