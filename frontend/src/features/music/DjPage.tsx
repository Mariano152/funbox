"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FunboxLogo } from "@/features/games/FunboxLogo";
import { getRoom } from "@/features/rooms/room.api";
import type { PlayerSession, Room } from "@/features/rooms/room.types";
import { useRoomSocket } from "@/features/rooms/use-room-socket";
import {
  connectDj,
  finishMusicClip,
  markMusicStarted,
  prepareManualMusicRound,
  prepareMusicRound,
  replaceMusicRound,
  revealMusicRound,
  type MusicPublicState,
} from "./music.api";
import { useMusicSocket } from "./use-music-socket";
import { loadYoutubeApi, type YoutubePlayer } from "./youtube-player";

export function DjPage({ code }: { code: string }) {
  const [token, setToken] = useState("");
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<MusicPublicState | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [manualTrack, setManualTrack] = useState({ title: "", artist: "", youtubeUrl: "" });
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YoutubePlayer | null>(null);
  const tokenRef = useRef("");
  const stateRef = useRef<MusicPublicState | null>(null);
  const preparingRef = useRef(false);
  const startingRef = useRef(false);
  const playerStateRef = useRef(-1);
  const recoveryRef = useRef({ videoId: "", reloads: 0, replacing: false });
  const updateState = useCallback((next: MusicPublicState) => setState(next), []);
  const updateRoom = useCallback((next: Room) => setRoom(next), []);
  useMusicSocket(code, updateState);
  useRoomSocket(code, updateRoom);

  const rebuildPlayer = useCallback((message: string) => {
    if (!stateRef.current?.videoId) return;
    player.current?.destroy();
    player.current = null;
    playerStateRef.current = -1;
    startingRef.current = false;
    setPlayerReady(false);
    setPlayRequested(false);
    setError(message);
    setPlayerGeneration((current) => current + 1);
  }, []);

  const replaceFailedVideo = useCallback(async (reason: string) => {
    const currentToken = tokenRef.current;
    const currentVideoId = stateRef.current?.videoId;
    if (!currentToken || !currentVideoId || recoveryRef.current.replacing) return;
    recoveryRef.current.replacing = true;
    setError(`${reason}. Buscando una canción de reserva…`);
    try {
      const nextState = await replaceMusicRound(code, currentToken);
      recoveryRef.current = {
        videoId: nextState.videoId ?? "",
        reloads: 0,
        replacing: false,
      };
      setPlayRequested(false);
      setError("");
      updateState(nextState);
    } catch (reasonCaught) {
      recoveryRef.current.replacing = false;
      setError(
        reasonCaught instanceof Error
          ? reasonCaught.message
          : "No pudimos cargar una canción de reserva",
      );
    }
  }, [code, updateState]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      getRoom(code)
        .then(async (currentRoom) => {
          setRoom(currentRoom);
          const dj = currentRoom.players.find((player) => player.isDj);
          const stored = localStorage.getItem(`funbox:dj:${code}`);
          if (!stored) throw new Error("Esta pestaña no tiene la sesión del jugador DJ.");
          const playerSession = JSON.parse(stored) as PlayerSession;
          if (!dj || playerSession.playerId !== dj.id) {
            localStorage.removeItem(`funbox:dj:${code}`);
            throw new Error("Esta cuenta no es el DJ actual de la sala.");
          }
          setSession(playerSession);
          return connectDj(code, playerSession);
        })
        .then(({ djToken, state: initialState }) => {
          setToken(djToken);
          tokenRef.current = djToken;
          setState(initialState);
        })
        .catch((reason) => setError(reason.message));
    });
    return () => cancelAnimationFrame(frame);
  }, [code]);

  useEffect(() => {
    if (!room || !session) return;
    const currentDj = room.players.find((player) => player.isDj);
    if (currentDj?.id === session.playerId) return;
    localStorage.removeItem(`funbox:dj:${code}`);
    tokenRef.current = "";
    const timeout = window.setTimeout(() => {
      setToken("");
      setError("Esta cuenta ya no es el DJ actual de la sala.");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [code, room, session]);

  useEffect(() => {
    if (!state?.videoId || !playerHost.current || player.current) return;
    let cancelled = false;
    loadYoutubeApi().then((YT) => {
      if (cancelled || !playerHost.current) return;
      player.current = new YT.Player(playerHost.current, {
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => setPlayerReady(true),
          onAutoplayBlocked: () => {
            setError("El navegador bloqueó el inicio automático. Pulsa Play en YouTube o recarga el video.");
          },
          onStateChange: (event) => {
            playerStateRef.current = event.data;
            if (event.data !== 1 || stateRef.current?.phase !== "ready" || startingRef.current) return;
            recoveryRef.current.reloads = 0;
            setError("");
            const currentToken = tokenRef.current;
            if (!currentToken) return;
            startingRef.current = true;
            markMusicStarted(code, currentToken)
              .then(updateState)
              .catch((reason) => setError(reason.message))
              .finally(() => {
                startingRef.current = false;
              });
          },
          onError: (event) => {
            void replaceFailedVideo(`YouTube rechazó el video (código ${event.data})`);
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [code, playerGeneration, replaceFailedVideo, state?.videoId, updateState]);

  useEffect(() => {
    return () => {
      player.current?.destroy();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    if (!playerReady || !state?.videoId) return;
    if (recoveryRef.current.videoId !== state.videoId) {
      recoveryRef.current = { videoId: state.videoId, reloads: 0, replacing: false };
    }
    player.current?.loadVideoById({
      videoId: state.videoId,
      startSeconds: state.startSeconds ?? 0,
      endSeconds: state.endSeconds ?? state.clipDuration,
    });
    const frame = requestAnimationFrame(() => setPlayRequested(true));
    const slowLoadTimeout = window.setTimeout(() => {
      if (stateRef.current?.phase !== "ready" || startingRef.current) return;
      if (playerStateRef.current === 3) {
        if (recoveryRef.current.reloads < 1) {
          recoveryRef.current.reloads += 1;
          rebuildPlayer("YouTube sigue cargando; reintentando automáticamente…");
        } else {
          void replaceFailedVideo("YouTube no terminó de cargar después del reintento");
        }
      } else if (playerStateRef.current === -1 || playerStateRef.current === 5) {
        setError("El dispositivo bloqueó el autoplay con sonido. Pulsa Play en el reproductor de YouTube.");
      }
    }, 15_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(slowLoadTimeout);
    };
  }, [playerGeneration, playerReady, rebuildPlayer, replaceFailedVideo, state?.videoId, state?.startSeconds, state?.endSeconds, state?.clipDuration]);

  useEffect(() => {
    if (
      room?.status !== "playing" ||
      state?.phase !== "ready" ||
      state.videoId ||
      !token ||
      preparingRef.current
    ) return;

    preparingRef.current = true;
    prepareMusicRound(code, token)
      .then(updateState)
      .catch(async (reason) => {
        if (reason instanceof Error && reason.message.includes("no está autorizado") && session) {
          const connected = await connectDj(code, session);
          setToken(connected.djToken);
          tokenRef.current = connected.djToken;
          updateState(await prepareMusicRound(code, connected.djToken));
          return;
        }
        setError(reason instanceof Error ? reason.message : "No pudimos preparar la ronda");
      })
      .finally(() => {
        preparingRef.current = false;
      });
  }, [code, room?.status, session, state?.phase, state?.videoId, token, updateState]);

  useEffect(() => {
    if (state?.phase !== "playing" || !token || !state.deadlineAt) return;
    player.current?.playVideo();
    const delay = Math.max(0, new Date(state.deadlineAt).getTime() - Date.now());
    const timeout = window.setTimeout(async () => {
      player.current?.pauseVideo();
      try {
        updateState(await finishMusicClip(code, token));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No pudimos abrir las respuestas");
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [code, state?.phase, state?.deadlineAt, token, updateState]);

  useEffect(() => {
    if (state?.phase === "paused") player.current?.pauseVideo();
  }, [state?.phase]);

  useEffect(() => {
    if (state?.phase !== "answering" || !token || !state.deadlineAt) return;
    player.current?.pauseVideo();
    const delay = Math.max(0, new Date(state.deadlineAt).getTime() - Date.now());
    const timeout = window.setTimeout(async () => {
      try {
        updateState(await revealMusicRound(code, token));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No pudimos revelar la canción");
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [code, state?.phase, state?.deadlineAt, token, updateState]);

  useEffect(() => {
    if (
      state?.phase !== "reveal" ||
      !token ||
      preparingRef.current
    ) return;

    const timeout = window.setTimeout(() => {
      if (state.roundNumber >= state.totalRounds) {
        revealMusicRound(code, token)
          .then(updateState)
          .catch((reason) => setError(reason.message));
        return;
      }
      preparingRef.current = true;
      prepareMusicRound(code, token)
        .then((nextState) => {
          setPlayRequested(false);
          updateState(nextState);
        })
        .catch((reason) => setError(reason.message))
        .finally(() => {
          preparingRef.current = false;
        });
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [code, state?.phase, state?.roundNumber, state?.totalRounds, token, updateState]);

  async function prepare() {
    if (!token) return;
    setWorking(true);
    setError("");
    setPlayRequested(false);
    try {
      updateState(await prepareMusicRound(code, token));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos preparar la ronda");
    } finally {
      setWorking(false);
    }
  }

  function reloadPlayback() {
    recoveryRef.current.reloads = 0;
    rebuildPlayer("Reconectando con YouTube…");
  }

  async function prepareManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setWorking(true);
    setError("");
    setPlayRequested(false);
    try {
      updateState(await prepareManualMusicRound(code, token, manualTrack));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos usar ese video");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="dj-shell">
      <header className="dj-header">
        <FunboxLogo />
        <span>Dispositivo DJ · {code}</span>
      </header>
      <section className="dj-layout">
        <div className="dj-player-panel">
          <div className="youtube-player-frame">
            {!state?.videoId && (
              <div className="dj-player-placeholder">
                <span>♫</span>
                <strong>Cabina lista</strong>
                <small>La canción aparecerá cuando el líder inicie la partida.</small>
              </div>
            )}
            <div className="youtube-player-mount">
              <div key={playerGeneration} ref={playerHost} />
            </div>
          </div>
          <p className="youtube-policy-note">
            El reproductor oficial debe permanecer visible. Usa sus controles para anuncios o avisos.
          </p>
        </div>
        <aside className="dj-controls">
          <p className="eyebrow">Cabina de audio</p>
          <h1>Ronda {state?.roundNumber ?? 0}/{state?.totalRounds ?? "—"}</h1>
          {!state && <div className="waiting-pill"><i /> Conectando dispositivo…</div>}
          {state?.phase === "ready" && !state.videoId && (
            <div className="waiting-pill">
              <i /> {room?.status === "playing" ? "Preparando automáticamente…" : "Esperando al líder…"}
            </div>
          )}
          {state?.phase === "ready" && state.videoId && (
            <>
              <div className="dj-instruction">
                {playRequested
                  ? "Iniciando automáticamente. Si aparece un anuncio, usa los controles normales de YouTube."
                  : "Canción lista. Esperando al reproductor…"}
              </div>
              <div className="dj-playback-actions">
                <button className="dj-reload-button" onClick={reloadPlayback}>
                  ↻ Recargar video
                </button>
              </div>
            </>
          )}
          {state?.phase === "loading" && <div className="waiting-pill"><i /> La IA está eligiendo…</div>}
          {state?.phase === "playing" && (
            <div className="dj-now-playing">
              <strong>Fragmento en reproducción</strong>
              <span>{state.clipDuration} segundos</span>
            </div>
          )}
          {state?.phase === "answering" && (
            <div className="dj-now-playing">
              <strong>Tiempo de respuestas</strong>
              <span>La música está pausada</span>
            </div>
          )}
          {state?.phase === "paused" && (
            <div className="dj-now-playing">
              <strong>Partida pausada desde la TV</strong>
              <span>El tiempo y la música están detenidos</span>
            </div>
          )}
          {state?.phase === "reveal" && (
            <>
              <div className="dj-reveal">
                <small>Respuesta</small>
                <strong>{state.revealedTrack?.title}</strong>
                <span>{state.revealedTrack?.artist}</span>
              </div>
              {state.roundNumber < state.totalRounds
                ? <div className="waiting-pill"><i /> Siguiente ronda automática…</div>
                : <strong>¡Partida terminada!</strong>}
            </>
          )}
          {state?.phase === "finished" && (
            <div className="dj-reveal">
              <small>Partida terminada</small>
              <strong>¡Gracias por poner la música!</strong>
              <span>El líder puede volver a la sala para jugar otra vez.</span>
            </div>
          )}
          {state?.phase === "error" && (
            <>
              <button className="start-button dj-action" onClick={prepare}><span>Reintentar selección</span><i>↻</i></button>
              <form className="dj-manual-form" onSubmit={prepareManual}>
                <strong>Alternativa manual</strong>
                <small>Pega un video oficial embebible. La respuesta sólo se verá en este dispositivo.</small>
                <input
                  placeholder="Título de la canción"
                  value={manualTrack.title}
                  onChange={(event) => setManualTrack({ ...manualTrack, title: event.target.value })}
                  required
                />
                <input
                  placeholder="Artista"
                  value={manualTrack.artist}
                  onChange={(event) => setManualTrack({ ...manualTrack, artist: event.target.value })}
                  required
                />
                <input
                  placeholder="https://youtube.com/watch?v=…"
                  type="url"
                  value={manualTrack.youtubeUrl}
                  onChange={(event) => setManualTrack({ ...manualTrack, youtubeUrl: event.target.value })}
                  required
                />
                <button disabled={working}>Usar este video</button>
              </form>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
          <Link className="text-link" href={`/room/${code}`}>Volver a mi jugador</Link>
        </aside>
      </section>
    </main>
  );
}
