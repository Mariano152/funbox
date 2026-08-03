"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import type { PlayerSession, Room, RoomPlayer } from "@/features/rooms/room.types";
import {
  getMusicState,
  getMusicSuggestions,
  saveMusicAnswerDraft,
  submitMusicAnswer,
  type MusicPublicState,
} from "./music.api";
import { useMusicSocket } from "./use-music-socket";

export function MusicPlayerPage({
  room,
  player,
  session,
}: {
  room: Room;
  player: RoomPlayer;
  session: PlayerSession;
}) {
  const [state, setState] = useState<MusicPublicState | null>(null);
  const [song, setSong] = useState("");
  const [artist, setArtist] = useState("");
  const [error, setError] = useState("");
  const [songSuggestions, setSongSuggestions] = useState<string[]>([]);
  const [artistSuggestions, setArtistSuggestions] = useState<string[]>([]);
  const [focusedField, setFocusedField] = useState<"song" | "artist" | null>(null);
  const [sending, setSending] = useState(false);
  const updateState = useCallback((next: MusicPublicState) => setState(next), []);
  const result = state?.answerResults?.[player.id];
  const score = state?.scores?.[player.id] ?? 0;
  const canAnswer = state?.phase === "playing" || state?.phase === "answering";
  const songRef = useRef("");
  const artistRef = useRef("");
  const autoSubmittedRound = useRef(0);
  useMusicSocket(room.code, updateState);

  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { artistRef.current = artist; }, [artist]);

  useEffect(() => {
    getMusicState(room.code).then(setState).catch((reason) => setError(reason.message));
  }, [room.code]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSong("");
      setArtist("");
      setError("");
    });
    return () => cancelAnimationFrame(frame);
  }, [state?.roundNumber]);

  useEffect(() => {
    if (song.trim().length < 3 || result?.songCorrect) {
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      getMusicSuggestions("song", song)
        .then(({ suggestions }) => { if (active) setSongSuggestions(suggestions); })
        .catch(() => { if (active) setSongSuggestions([]); });
    }, 550);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [song, result?.songCorrect]);

  useEffect(() => {
    if (artist.trim().length < 3 || result?.artistCorrect) {
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      getMusicSuggestions("artist", artist)
        .then(({ suggestions }) => { if (active) setArtistSuggestions(suggestions); })
        .catch(() => { if (active) setArtistSuggestions([]); });
    }, 550);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [artist, result?.artistCorrect]);

  const sendCurrentAnswer = useCallback(async () => {
    const currentSong = songRef.current;
    const currentArtist = artistRef.current;
    if (!currentSong.trim() && !currentArtist.trim()) return;
    setSending(true);
    setError("");
    try {
      const response = await submitMusicAnswer(session, {
        song: currentSong,
        artist: currentArtist,
      });
      setState(response.state);
      if (!response.result.songCorrect) setSong("");
      if (!response.result.artistCorrect) setArtist("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos revisar tu respuesta");
    } finally {
      setSending(false);
    }
  }, [session]);

  const flushDraft = useCallback(() => {
    if (
      !["playing", "answering", "reveal"].includes(state?.phase ?? "") ||
      !state?.roundNumber
    ) return Promise.resolve();
    return saveMusicAnswerDraft(session, {
      roundNumber: state.roundNumber,
      song: songRef.current,
      artist: artistRef.current,
    }).then(() => undefined);
  }, [session, state]);

  useEffect(() => {
    if (!["playing", "answering"].includes(state?.phase ?? "")) return;
    const timeout = window.setTimeout(() => {
      void flushDraft().catch(() => undefined);
    }, 180);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        void flushDraft().catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", saveWhenHidden);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", saveWhenHidden);
      document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [song, artist, state?.phase, flushDraft]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCurrentAnswer();
  }

  useEffect(() => {
    if (state?.phase !== "answering" || !state.deadlineAt) return;
    if (autoSubmittedRound.current === state.roundNumber) return;
    const delay = Math.max(0, new Date(state.deadlineAt).getTime() - Date.now() - 350);
    const timeout = window.setTimeout(() => {
      autoSubmittedRound.current = state.roundNumber;
      void sendCurrentAnswer();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [state?.phase, state?.deadlineAt, state?.roundNumber, sendCurrentAnswer]);

  useEffect(() => {
    if (state?.phase !== "reveal" || autoSubmittedRound.current === state.roundNumber) return;
    if (!songRef.current.trim() && !artistRef.current.trim()) return;
    autoSubmittedRound.current = state.roundNumber;
    void sendCurrentAnswer();
  }, [state?.phase, state?.roundNumber, sendCurrentAnswer]);

  return (
    <main className="phone-shell music-player-shell">
      <section className={`phone-card music-player-card player-phone-${player.avatarColor}`}>
        <header className="music-player-header">
          <AvatarCharacter avatarKey={player.avatarKey} compact />
          <div>
            <p className="phone-eyebrow">Ronda {state?.roundNumber ?? 0}/{state?.totalRounds ?? "—"}</p>
            <strong>{player.nickname}</strong>
          </div>
          <div className="music-player-score"><span>Puntos</span><strong>{score}</strong></div>
        </header>

        {canAnswer ? (
          <>
            <div className="music-player-title">
              <span>♫</span>
              <h1>¿Cuál es?</h1>
              <p>
                {state?.phase === "playing"
                  ? "Puedes responder mientras escuchas la canción."
                  : "La música se detuvo. Responde antes de que termine el tiempo."}
              </p>
            </div>
            <form className="music-answer-form" onSubmit={submit}>
              <label htmlFor="song-answer">Canción</label>
              <div className="autocomplete-field">
              <div className={`answer-input ${result?.songCorrect ? "correct" : ""}`}>
                <input
                  id="song-answer"
                  value={song}
                  onChange={(event) => setSong(event.target.value)}
                  onFocus={() => setFocusedField("song")}
                  onBlur={() => {
                    window.setTimeout(() => setFocusedField(null), 120);
                    void flushDraft().catch(() => undefined);
                  }}
                  placeholder="Escribe el título"
                  disabled={result?.songCorrect}
                  autoComplete="off"
                />
                <span>{result?.songCorrect ? "✓" : "♪"}</span>
              </div>
              {focusedField === "song" && song.trim().length >= 3 && songSuggestions.length > 0 && (
                <div className="answer-suggestions" role="listbox">
                  {songSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onMouseDown={() => setSong(suggestion)}>
                      <span>♪</span>{suggestion}
                    </button>
                  ))}
                </div>
              )}
              </div>
              <label htmlFor="artist-answer">Artista</label>
              <div className="autocomplete-field">
              <div className={`answer-input ${result?.artistCorrect ? "correct" : ""}`}>
                <input
                  id="artist-answer"
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                  onFocus={() => setFocusedField("artist")}
                  onBlur={() => {
                    window.setTimeout(() => setFocusedField(null), 120);
                    void flushDraft().catch(() => undefined);
                  }}
                  placeholder="Escribe el artista"
                  disabled={result?.artistCorrect}
                  autoComplete="off"
                />
                <span>{result?.artistCorrect ? "✓" : "★"}</span>
              </div>
              {focusedField === "artist" && artist.trim().length >= 3 && artistSuggestions.length > 0 && (
                <div className="answer-suggestions" role="listbox">
                  {artistSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onMouseDown={() => setArtist(suggestion)}>
                      <span>★</span>{suggestion}
                    </button>
                  ))}
                </div>
              )}
              </div>
              <button className="start-button music-answer-submit" disabled={sending || !canAnswer}>
                <span>{sending ? "Revisando…" : "Comprobar"}</span><i>→</i>
              </button>
            </form>
            {result?.submitted && !result.songCorrect && !result.artistCorrect && (
              <p className="answer-feedback wrong">Todavía no. ¡Intenta otra vez!</p>
            )}
            {result?.songCorrect && !result.artistCorrect && (
              <p className="answer-feedback partial">¡Canción correcta! Falta el artista.</p>
            )}
            {!result?.songCorrect && result?.artistCorrect && (
              <p className="answer-feedback partial">¡Artista correcto! Falta la canción.</p>
            )}
            {result?.songCorrect && result.artistCorrect && (
              <p className="answer-feedback complete">¡Perfecto! Ganaste 2 puntos.</p>
            )}
          </>
        ) : state?.phase === "paused" ? (
          <div className="player-round-waiting">
            <strong>Partida pausada</strong>
            <span>Tus respuestas permanecen guardadas en este dispositivo.</span>
          </div>
        ) : state?.phase === "finished" ? (
          <div className="player-round-reveal player-finished">
            <small>Partida terminada</small>
            <strong>{score} puntos</strong>
            <span>Mira el podio en la televisión.</span>
            <div className="waiting-pill"><i /> El líder puede volver al lobby</div>
          </div>
        ) : state?.phase === "reveal" ? (
          <div className="player-round-reveal">
            <small>La respuesta era</small>
            <strong>{state.revealedTrack?.title}</strong>
            <span>{state.revealedTrack?.artist}</span>
            <div className="waiting-pill"><i /> Preparando siguiente ronda…</div>
          </div>
        ) : (
          <div className="player-round-waiting">
            <div className="loading-jelly" />
            <strong>Preparando la canción…</strong>
            <span>Mira la televisión y escucha al DJ.</span>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}
