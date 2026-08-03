"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import { getGame } from "@/features/games/game-catalog";
import { MusicTvPage } from "@/features/music/MusicTvPage";
import { MusicConfigFields } from "@/features/music/MusicConfigFields";
import { DEFAULT_MUSIC_CONFIG, type MusicGameConfig } from "@/features/music/music.types";
import { getRoom, updateMusicConfig } from "@/features/rooms/room.api";
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
        {player.isDj && <span className="dj-badge">DJ</span>}
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

function JoinQr({ url, code }: { url: string; code: string }) {
  return (
    <a className="qr" href={url} aria-label={`Abrir la sala ${code} para unirse`}>
      <QRCode value={url} size={78} level="M" bgColor="#ffffff" fgColor="#09091f" />
    </a>
  );
}

export function LobbyPage({ code }: { code: string }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [joinUrl, setJoinUrl] = useState(`https://funbox.game/join?code=${code}`);
  const [configOpen, setConfigOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState("");
  const [musicConfig, setMusicConfig] = useState<MusicGameConfig>(DEFAULT_MUSIC_CONFIG);
  const updateRoom = useCallback((nextRoom: Room) => {
    setRoom(nextRoom);
    if (nextRoom.gameKey === "guess-the-song") {
      const savedConfig = nextRoom.gameConfig as Record<string, unknown>;
      const legacyLanguage =
        typeof savedConfig.language === "string" &&
        ["es", "en", "international"].includes(savedConfig.language)
          ? [savedConfig.language]
          : [];
      const legacyDifficulty =
        typeof savedConfig.difficulty === "string" &&
        ["easy", "medium", "hard"].includes(savedConfig.difficulty)
          ? [savedConfig.difficulty]
          : [];
      setMusicConfig({
        ...DEFAULT_MUSIC_CONFIG,
        ...savedConfig,
        languages: Array.isArray(savedConfig.languages)
          ? savedConfig.languages
          : legacyLanguage,
        difficulties: Array.isArray(savedConfig.difficulties)
          ? savedConfig.difficulties
          : legacyDifficulty,
      } as MusicGameConfig);
    }
  }, []);
  useRoomSocket(code, updateRoom);

  useEffect(() => {
    getRoom(code).then(updateRoom).catch((reason) => setError(reason.message));
    const frame = requestAnimationFrame(() => {
      setJoinUrl(`${window.location.origin}/join?code=${encodeURIComponent(code)}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [code, updateRoom]);

  if (error) {
    return <main className="state-shell"><h1>No encontramos esa sala</h1><p>{error}</p></main>;
  }
  if (!room) {
    return <main className="state-shell"><div className="loading-jelly" /><p>Preparando la fiesta…</p></main>;
  }

  const dj = room.players.find((player) => player.isDj);
  const players = room.players.filter((player) => !player.isDj);
  const emptySlots = Array.from({ length: Math.max(0, 8 - players.length) });
  const leader = room.players.find((player) => player.isHost);
  const game = getGame(room.gameKey);
  const joinAddress = joinUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "");

  async function saveConfig() {
    setSavingConfig(true);
    setConfigError("");
    try {
      updateRoom(await updateMusicConfig(code, musicConfig));
      setConfigOpen(false);
    } catch (reason) {
      setConfigError(reason instanceof Error ? reason.message : "No pudimos preparar la configuración");
    } finally {
      setSavingConfig(false);
    }
  }

  if (room.status === "playing" && room.gameKey === "guess-the-song") {
    return <MusicTvPage code={code} room={room} />;
  }

  return (
    <main className="lobby-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="lobby-header">
        <FunboxLogo />
        <div className="header-actions">
          <span className="player-count">{players.length}/8</span>
          {room.gameKey === "guess-the-song" && (
            <button className="icon-button config-button" onClick={() => setConfigOpen(true)} aria-label="Configurar juego">⚙</button>
          )}
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
            <JoinQr url={joinUrl} code={room.code} />
            <div><strong>Escanea para unirte</strong><span>o escribe el código {room.code}</span></div>
          </div>
        </div>

        <div className="party-panel">
          <div className="party-heading">
            <div>
              <p className="eyebrow">{game?.name ?? "La fiesta se está armando"}</p>
              <h1>
                {room.status === "playing"
                  ? "¡La fiesta comenzó!"
                  : room.players.length === 0
                    ? "Esperando a la primera gelatina"
                    : `${players.length} ${players.length === 1 ? "gelatina lista" : "gelatinas listas"}`}
              </h1>
            </div>
            <span className={`status-pill status-${room.status}`}><i /> {room.status === "lobby" ? "Sala abierta" : "En juego"}</span>
          </div>

          {room.gameKey === "guess-the-song" && (
            <div className="dj-stage-slot">
              {dj
                ? <PlayerCard player={dj} index={8} />
                : <div className="dj-empty-slot"><strong>Cabina DJ</strong><span>Un jugador puede ocuparla</span></div>}
            </div>
          )}
          <div className="players-grid players-grid-eight">
            {players.map((player, index) => <PlayerCard key={player.id} player={player} index={index} />)}
            {emptySlots.map((_, index) => <EmptySlot key={index} number={players.length + index + 1} />)}
          </div>

          <div className="lobby-footer">
            <div className="host-note">
              <span>★</span>
              <div>
                <strong>{leader ? `${leader.nickname} dirige la fiesta` : "El primero en entrar será líder"}</strong>
                <small>El botón para comenzar aparece en su celular</small>
              </div>
            </div>
            {room.gameKey === "guess-the-song" && (
              <div className="dj-lobby-status">
                {room.players.find((player) => player.isDj)
                  ? `${room.players.find((player) => player.isDj)?.nickname} está en la cabina DJ`
                  : "Esperando que un jugador elija ser DJ"}
              </div>
            )}
            <div className="tv-waiting">
              {room.status === "playing" ? "Preparando el primer juego…" : "Esperando al líder…"}
            </div>
          </div>
        </div>
      </section>
      {configOpen && (
        <div className="config-modal-backdrop" role="presentation" onMouseDown={() => setConfigOpen(false)}>
          <section className="config-modal" role="dialog" aria-modal="true" aria-label="Configuración musical" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p className="eyebrow">Antes de empezar</p><h2>Configura la partida</h2></div><button onClick={() => setConfigOpen(false)}>×</button></header>
            <MusicConfigFields value={musicConfig} onChange={setMusicConfig} compact />
            <p>Al confirmar se selecciona la playlist, se preparan hasta 70 embeddings y se precargan los videos.</p>
            {configError && <p className="form-error">{configError}</p>}
            <button className="start-button config-save" onClick={saveConfig} disabled={savingConfig}><span>{savingConfig ? "Preparando música…" : "Confirmar y preparar"}</span><i>✓</i></button>
          </section>
        </div>
      )}
    </main>
  );
}
