"use client";

import { useCallback, useEffect, useState } from "react";
import { FunboxLogo } from "@/features/games/FunboxLogo";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import type { Room } from "@/features/rooms/room.types";
import { getMusicState, returnMusicToLobby, setMusicPaused, type MusicPublicState } from "./music.api";
import { useMusicSocket } from "./use-music-socket";

export function MusicTvPage({
  code,
  room,
  onReturnToLobby,
}: {
  code: string;
  room: Room;
  onReturnToLobby: (room: Room) => void;
}) {
  const [state, setState] = useState<MusicPublicState | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [djAddress, setDjAddress] = useState(`/dj/${code}`);
  const [pauseWorking, setPauseWorking] = useState(false);
  const [replayWorking, setReplayWorking] = useState(false);
  const [replayError, setReplayError] = useState("");
  const updateState = useCallback((next: MusicPublicState) => setState(next), []);
  useMusicSocket(code, updateState);

  useEffect(() => {
    getMusicState(code).then(setState).catch(() => undefined);
    const frame = requestAnimationFrame(() => setDjAddress(`${window.location.host}/dj/${code}`));
    return () => cancelAnimationFrame(frame);
  }, [code]);

  useEffect(() => {
    if (!state?.deadlineAt) {
      const frame = requestAnimationFrame(() => setSeconds(0));
      return () => cancelAnimationFrame(frame);
    }
    const update = () => setSeconds(Math.max(0, Math.ceil((new Date(state.deadlineAt as string).getTime() - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [state?.deadlineAt]);

  const statusText = {
    waiting_for_dj: "Esperando el dispositivo DJ",
    ready: state?.videoId ? "Canción lista en la cabina" : "DJ conectado",
    loading: "La IA está eligiendo una canción",
    playing: "¡Escucha la canción!",
    answering: "¡Escribe tus respuestas!",
    paused: "Partida pausada",
    reveal: "La canción era…",
    finished: "¡Tenemos ganadores!",
    error: "La cabina necesita ayuda",
  }[state?.phase ?? "waiting_for_dj"];
  const ranking = room.players
    .filter((player) => !player.isDj)
    .map((player) => ({ ...player, score: state?.scores?.[player.id] ?? 0 }))
    .sort((left, right) => right.score - left.score);
  const podiumOrder = ranking.length === 1 ? [1] : ranking.length === 2 ? [2, 1] : [2, 1, 3];

  async function togglePause() {
    if (!state) return;
    setPauseWorking(true);
    try {
      setState(await setMusicPaused(code, state.phase !== "paused"));
    } finally {
      setPauseWorking(false);
    }
  }

  async function replay() {
    if (replayWorking) return;
    setReplayWorking(true);
    setReplayError("");
    try {
      const lobbyRoom = await returnMusicToLobby(code);
      // No esperamos al socket ni al siguiente sondeo: la pantalla anfitriona
      // cambia al lobby con la respuesta autoritativa del backend.
      onReturnToLobby(lobbyRoom);
      setReplayWorking(false);
    } catch (reason) {
      setReplayError(
        reason instanceof Error ? reason.message : "No pudimos preparar la nueva partida",
      );
      setReplayWorking(false);
    }
  }

  return (
    <main className="music-tv-shell">
      <header className="music-tv-header">
        <FunboxLogo />
        <div>
          <span>Sala {code}</span>
          <strong>{room.players.filter((player) => !player.isDj).length}/8</strong>
          {state && ["playing", "answering", "paused"].includes(state.phase) && (
            <button className="tv-pause-button" onClick={togglePause} disabled={pauseWorking}>
              {state.phase === "paused" ? "▶ Reanudar" : "Ⅱ Pausar"}
            </button>
          )}
        </div>
      </header>
      <section className={`music-stage music-stage-${state?.phase ?? "waiting"}`}>
        {state?.phase === "finished" ? (
          <div className="music-results">
            <p className="eyebrow">Fin de la partida</p>
            <h1>¡La fiesta tiene campeones!</h1>
            <div className="music-podium">
              {podiumOrder.map((place) => {
                const actualPlayer = ranking[place - 1];
                if (!actualPlayer) return null;
                return (
                  <article className={`podium-place podium-${place}`} key={actualPlayer.id}>
                    <span className="podium-medal">{place}</span>
                    <AvatarCharacter avatarKey={actualPlayer.avatarKey} index={place - 1} />
                    <strong>{actualPlayer.nickname}</strong>
                    <small>{actualPlayer.score} puntos</small>
                    <i>{place === 1 ? "CAMPEÓN" : `${place}º lugar`}</i>
                  </article>
                );
              })}
            </div>
            {ranking.length > 3 && (
              <div className="music-rest-ranking">
                {ranking.slice(3).map((player, index) => (
                  <article key={player.id}>
                    <span>{index + 4}</span>
                    <AvatarCharacter avatarKey={player.avatarKey} compact />
                    <strong>{player.nickname}</strong>
                    <small>{player.score} pts</small>
                  </article>
                ))}
              </div>
            )}
            {replayError && <p className="form-error">{replayError}</p>}
            <button className="start-button results-replay" onClick={() => void replay()} disabled={replayWorking}>
              <span>{replayWorking ? "Preparando nueva partida…" : "Volver a jugar"}</span><i>↻</i>
            </button>
          </div>
        ) : (
        <>
        <div className="music-disc" aria-hidden="true"><i /><span>FUN<br />BOX</span></div>
        <p className="eyebrow">Adivina la canción · Ronda {state?.roundNumber ?? 0}/{state?.totalRounds ?? "—"}</p>
        <h1>{statusText}</h1>
        {["playing", "answering"].includes(state?.phase ?? "") && <div className="music-countdown">{seconds}</div>}
        {["playing", "answering"].includes(state?.phase ?? "") && (
          <div className="tv-answer-status">
            {room.players.filter((player) => !player.isDj).map((player) => {
              const result = state?.answerResults?.[player.id];
              return (
                <div key={player.id}>
                  <strong>{player.nickname}</strong>
                  <span className={result?.songCorrect ? "correct" : ""}>
                    Canción {result?.songCorrect ? "✓" : "·"}
                  </span>
                  <span className={result?.artistCorrect ? "correct" : ""}>
                    Artista {result?.artistCorrect ? "✓" : "·"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {state?.phase === "paused" && (
          <div className="music-paused-card">
            <strong>El reloj está detenido</strong>
            <span>Pueden reconectarse con calma. Pulsa Reanudar cuando estén listos.</span>
          </div>
        )}
        {state?.phase === "reveal" && (
          <div className="music-answer">
            <strong>{state.revealedTrack?.title}</strong>
            <span>{state.revealedTrack?.artist}</span>
          </div>
        )}
        {!state?.djConnected && (
          <div className="dj-connect-callout">
            <span>Abre en el dispositivo de audio</span>
            <strong>{djAddress}</strong>
          </div>
        )}
        {state?.error && <p className="form-error">{state.error}</p>}
        <div className="music-equalizer" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -0.08}s` }} />)}
        </div>
        </>
        )}
      </section>
    </main>
  );
}
