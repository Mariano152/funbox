"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AvatarCharacter, AVATAR_CATALOG } from "@/features/avatars/avatar-catalog";
import { MusicPlayerPage } from "@/features/music/MusicPlayerPage";
import { changeAvatar, changeDjRole, getRoom, startRoom } from "./room.api";
import type { AvatarKey, PlayerSession, Room } from "./room.types";
import { useRoomSocket } from "./use-room-socket";

export function PlayerRoomPage({ code }: { code: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [error, setError] = useState("");
  const [changingAvatar, setChangingAvatar] = useState<AvatarKey | null>(null);
  const [changingDj, setChangingDj] = useState(false);
  const updateRoom = useCallback((nextRoom: Room) => setRoom(nextRoom), []);
  useRoomSocket(code, updateRoom);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = localStorage.getItem(`funbox:active:${code}`);
      if (stored) setSession(JSON.parse(stored) as PlayerSession);
    });
    getRoom(code).then(setRoom).catch((reason) => setError(reason.message));
    return () => cancelAnimationFrame(frame);
  }, [code]);

  async function handleStart() {
    if (!session) return;
    setError("");
    try {
      setRoom(await startRoom(session));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos comenzar");
    }
  }

  async function handleAvatarChange(avatarKey: AvatarKey) {
    if (!session || changingAvatar) return;
    setChangingAvatar(avatarKey);
    setError("");
    try {
      setRoom(await changeAvatar(session, avatarKey));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cambiar el personaje");
    } finally {
      setChangingAvatar(null);
    }
  }

  async function handleDjChange() {
    if (!session || !me || changingDj) return;
    setChangingDj(true);
    setError("");
    try {
      const nextRoom = await changeDjRole(session, !me.isDj);
      setRoom(nextRoom);
      const confirmedMe = nextRoom.players.find((player) => player.id === session.playerId);
      if (confirmedMe?.isDj) {
        localStorage.setItem(`funbox:dj:${code}`, JSON.stringify(session));
        router.push(`/dj/${code}`);
      } else {
        localStorage.removeItem(`funbox:dj:${code}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos cambiar el DJ");
    } finally {
      setChangingDj(false);
    }
  }

  const me = room?.players.find((player) => player.id === session?.playerId);
  const currentDj = room?.players.find((player) => player.isDj);

  if (!room || !session) {
    return <main className="phone-shell"><section className="phone-card success-card"><p>{error || "Recuperando tu gelatina…"}</p></section></main>;
  }

  if (room.status === "playing" && room.gameKey === "guess-the-song" && me && !me.isDj) {
    return <MusicPlayerPage room={room} player={me} session={session} />;
  }

  return (
    <main className="phone-shell">
      <section className={`phone-card success-card player-phone player-phone-${me?.avatarColor ?? "cyan"}`}>
        {me && <AvatarCharacter avatarKey={me.avatarKey} compact />}
        <p className="phone-eyebrow">
          {me?.isDj ? "Tú eres el DJ" : me?.isHost ? "Tú diriges la fiesta" : `Sala ${room.code}`}
        </p>
        <h1>Hola, {session.nickname}</h1>
        {room.status === "playing" ? (
          <>
            <p>¡La partida comenzó! Mira la pantalla principal.</p>
            <div className="waiting-pill"><i /> Preparando el primer juego</div>
          </>
        ) : (
          <>
            <p>{room.players.filter((candidate) => !candidate.isDj).length}/8 jugadores están listos{room.players.some((candidate) => candidate.isDj) ? " + DJ" : ""}. Tu identidad quedó guardada en este dispositivo.</p>
            {room.gameKey === "guess-the-song" && (
              <div className={`dj-role-card ${me?.isDj ? "selected" : ""}`}>
                <div>
                  <strong>{me?.isDj ? "Cabina DJ reservada para ti" : "¿Quieres ser el DJ?"}</strong>
                  <span>
                    {me?.isDj
                      ? "Reproducirás la música y no responderás esta partida."
                      : currentDj
                        ? `${currentDj.nickname} ya ocupa la cabina.`
                        : "Solo puede haber uno. El DJ no participa en las respuestas."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDjChange}
                  disabled={changingDj || Boolean(currentDj && !me?.isDj)}
                >
                  {changingDj ? "Cambiando…" : me?.isDj ? "Dejar cabina" : "Ser DJ"}
                </button>
              </div>
            )}
            <div className="avatar-picker">
              <div className="avatar-picker-heading">
                <strong>Elige tu personaje</strong>
                <span>Los ocupados no se pueden elegir</span>
              </div>
              <div className="avatar-options">
                {AVATAR_CATALOG.map((avatar) => {
                  const owner = room.players.find((player) => player.avatarKey === avatar.key);
                  const occupied = Boolean(owner && owner.id !== me?.id);
                  const selected = me?.avatarKey === avatar.key;
                  return (
                    <button
                      key={avatar.key}
                      type="button"
                      className={`avatar-option ${selected ? "selected" : ""}`}
                      disabled={occupied || Boolean(changingAvatar)}
                      onClick={() => handleAvatarChange(avatar.key)}
                    >
                      <AvatarCharacter avatarKey={avatar.key} compact />
                      <strong>{avatar.name}</strong>
                      <small>{occupied ? owner?.nickname : avatar.personality}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            {me?.isHost ? (
              <button
                className="start-button player-start"
                onClick={handleStart}
                disabled={room.gameKey === "guess-the-song" && !currentDj}
              >
                <span>Comenzar fiesta</span><i>→</i>
              </button>
            ) : (
              <div className="waiting-pill"><i /> Esperando a {room.players.find((player) => player.isHost)?.nickname}</div>
            )}
            {me?.isHost && room.gameKey === "guess-the-song" && !currentDj && (
              <small className="dj-required-note">Falta que un jugador tome la cabina DJ.</small>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
