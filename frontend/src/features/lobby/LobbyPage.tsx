"use client";

import { useCallback, useEffect, useState } from "react";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import { getRoom } from "@/features/rooms/room.api";
import type { Room, RoomPlayer } from "@/features/rooms/room.types";
import { useRoomSocket } from "@/features/rooms/use-room-socket";

function FunboxLogo() {
  return (
    <div className="funbox-logo" aria-label="Funbox">
      <span className="logo-pink">F</span><span className="logo-purple">U</span>
      <span className="logo-cyan">N</span><span className="logo-pink">B</span>
      <span className="logo-purple logo-face">O</span><span className="logo-lime">X</span>
    </div>
  );
}

function PlayerCard({ player, index }: { player: RoomPlayer; index: number }) {
  return (
    <article className={`player-card player-${player.avatarColor} player-enter`}>
      <div className="player-stage">
        {player.isHost && <span className="leader-badge">Líder</span>}
        <AvatarCharacter avatarKey={player.avatarKey} index={index} />
      </div>
      <div className="player-name">
        <span className="online-dot" />
        {player.nickname}
      </div>
    </article>
  );
}

function EmptySlot({ number }: { number: number }) {
  return (
    <div className="empty-player">
      <div className="empty-jelly">+</div>
      <span>Lugar {number}</span>
    </div>
  );
}

function QrPlaceholder() {
  return (
    <div className="qr" aria-label="Código QR provisional">
      {Array.from({ length: 64 }, (_, index) => (
        <i key={index} className={(index * 7 + Math.floor(index / 8) * 3) % 5 < 2 ? "on" : ""} />
      ))}
    </div>
  );
}

export function LobbyPage({ code }: { code: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [joinAddress, setJoinAddress] = useState("funbox.game/join");
  const updateRoom = useCallback((nextRoom: Room) => setRoom(nextRoom), []);
  useRoomSocket(code, updateRoom);

  useEffect(() => {
    getRoom(code).then(setRoom).catch((reason) => setError(reason.message));
    setJoinAddress(`${window.location.host}/join`);
  }, [code]);

  if (error) {
    return <main className="state-shell"><h1>No encontramos esa sala</h1><p>{error}</p></main>;
  }
  if (!room) {
    return <main className="state-shell"><div className="loading-jelly" /><p>Preparando la fiesta…</p></main>;
  }

  const emptySlots = Array.from({ length: 8 - room.players.length });
  const leader = room.players.find((player) => player.isHost);

  return (
    <main className="lobby-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="lobby-header">
        <FunboxLogo />
        <div className="header-actions">
          <span className="player-count">{room.players.length}/8</span>
          <button className="icon-button" aria-label="Sonido activado">♪</button>
        </div>
      </header>

      <section className="lobby-content">
        <div className="join-panel">
          <p className="eyebrow">Entra desde tu celular</p>
          <div className="join-address">{joinAddress}</div>
          <p className="room-label">Código de sala</p>
          <div className="room-code" aria-label={`Código de sala ${room.code}`}>
            {room.code.split("").map((letter, index) => <span key={`${letter}-${index}`}>{letter}</span>)}
          </div>
          <div className="join-hint">
            <QrPlaceholder />
            <div><strong>Escanea para unirte</strong><span>o escribe el código {room.code}</span></div>
          </div>
        </div>

        <div className="party-panel">
          <div className="party-heading">
            <div>
              <p className="eyebrow">La fiesta se está armando</p>
              <h1>
                {room.status === "playing"
                  ? "¡La fiesta comenzó!"
                  : room.players.length === 0
                    ? "Esperando a la primera gelatina"
                    : `${room.players.length} ${room.players.length === 1 ? "gelatina lista" : "gelatinas listas"}`}
              </h1>
            </div>
            <span className={`status-pill status-${room.status}`}><i /> {room.status === "lobby" ? "Sala abierta" : "En juego"}</span>
          </div>

          <div className="players-grid players-grid-eight">
            {room.players.map((player, index) => <PlayerCard key={player.id} player={player} index={index} />)}
            {emptySlots.map((_, index) => <EmptySlot key={index} number={room.players.length + index + 1} />)}
          </div>

          <div className="lobby-footer">
            <div className="host-note">
              <span>★</span>
              <div>
                <strong>{leader ? `${leader.nickname} dirige la fiesta` : "El primero en entrar será líder"}</strong>
                <small>El botón para comenzar aparece en su celular</small>
              </div>
            </div>
            <div className="tv-waiting">
              {room.status === "playing" ? "Preparando el primer juego…" : "Esperando al líder…"}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
