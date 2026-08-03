import Link from "next/link";
import { GAME_CATALOG } from "./game-catalog";
import { FunboxLogo } from "./FunboxLogo";

export function GamesPage() {
  return (
    <main className="games-shell">
      <header className="games-header">
        <FunboxLogo />
        <Link className="games-join-link" href="/join">Unirme con código</Link>
      </header>
      <section className="games-intro">
        <p className="eyebrow">El menú del desorden</p>
        <h1>¿Qué jugamos hoy?</h1>
        <p>Elige uno para crear su lobby. Después iremos construyéndolos uno por uno.</p>
      </section>
      <section className="game-grid" aria-label="Juegos disponibles">
        {GAME_CATALOG.map((game, index) => (
          <Link className={`game-card game-card-${game.accent}`} href={`/games/${game.key}`} key={game.key}>
            <span className="game-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="game-icon" aria-hidden="true">{game.icon}</div>
            <span className="game-category">{game.category}</span>
            <h2>{game.name}</h2>
            <p>{game.description}</p>
            <div className="game-meta"><span>{game.players} jugadores</span><span>{game.duration}</span></div>
            <span className="game-card-action">Elegir <i>→</i></span>
          </Link>
        ))}
      </section>
    </main>
  );
}
