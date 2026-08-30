"use client";
import { useCallback, useEffect, useState } from "react";
import { AvatarCharacter } from "@/features/avatars/avatar-catalog";
import { FunboxLogo } from "@/features/games/FunboxLogo";
import type { Room } from "@/features/rooms/room.types";
import { getTriviaState, pauseTrivia, replayTrivia } from "./trivia.api";
import type { TriviaState } from "./trivia.types";
import { useTriviaSocket } from "./use-trivia-socket";

export function TriviaTvPage({ room, onReturn }: { room: Room; onReturn: (room: Room) => void }) {
  const [state, setState] = useState<TriviaState | null>(null);
  const [working, setWorking] = useState(false);
  const update = useCallback((next: TriviaState) => setState(next), []);
  useTriviaSocket(room.code, update);
  useEffect(() => { getTriviaState(room.code).then(setState).catch(() => undefined); }, [room.code]);
  const ranking = room.players.map((player) => ({ ...player, score: state?.scores[player.id] ?? 0 })).sort((a, b) => b.score - a.score);

  async function togglePause() {
    if (!state || working) return; setWorking(true);
    try { setState(await pauseTrivia(room.code, state.phase !== "paused")); } finally { setWorking(false); }
  }
  async function replay() {
    if (working) return; setWorking(true);
    try { onReturn(await replayTrivia(room.code)); } finally { setWorking(false); }
  }

  return <main className="trivia-tv-shell">
    <header><FunboxLogo/><div className="trivia-tv-actions"><span>Sala <strong>{room.code}</strong></span>{state && ["question", "reveal", "paused"].includes(state.phase) && <button className="tv-pause-button" onClick={() => void togglePause()} disabled={working}>{state.phase === "paused" ? "▶ Reanudar" : "Ⅱ Pausar"}</button>}</div></header>
    <section className="trivia-tv-layout"><div className="trivia-board">
      {state?.phase === "finished" ? <><p className="eyebrow">Resultados</p><h1>¡Cerebros gelatinosos!</h1><button className="start-button" onClick={() => void replay()} disabled={working}><span>{working ? "Generando nuevas preguntas…" : "Volver a jugar"}</span><i>↻</i></button></>
      : state?.phase === "paused" ? <><p className="eyebrow">Partida pausada</p><h1>El tiempo está detenido</h1><p>Pueden volver a entrar con calma. La pregunta no cambiará hasta reanudar.</p></>
      : state?.question ? <><p className="eyebrow">Pregunta {state.roundNumber} de {state.totalRounds} · {state.question.difficulty}</p><h1>{state.question.question}</h1><div className="tv-trivia-options">{state.question.options.map((option,index)=><div className={state.phase === "reveal" && index === state.correctIndex ? "correct" : ""} key={option}><i>{String.fromCharCode(65+index)}</i>{option}</div>)}</div>{state.phase === "reveal" && <p className="trivia-explanation">{state.explanation}</p>}</>
      : <><h1>La trivia comienza…</h1><p>La primera pregunta aparecerá automáticamente.</p></>}
    </div><aside className="trivia-ranking"><h2>Ranking</h2>{ranking.map((player,index)=><div key={player.id}><span>{index+1}</span><AvatarCharacter avatarKey={player.avatarKey} compact/><strong>{player.nickname}</strong><b>{player.score}</b></div>)}</aside></section>
  </main>;
}
