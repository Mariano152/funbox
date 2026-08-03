import Link from "next/link";
import { AvatarCharacter, AVATAR_CATALOG } from "@/features/avatars/avatar-catalog";
import { FunboxLogo } from "./FunboxLogo";

export function HomePage() {
  return (
    <main className="home-shell">
      <div className="home-orb home-orb-one" /><div className="home-orb home-orb-two" />
      <section className="home-hero">
        <div className="home-copy">
          <FunboxLogo linked={false} />
          <p className="eyebrow home-eyebrow">Una fiesta. Muchos juegos. Cero calma.</p>
          <h1>Tu próxima fiesta cabe en una caja.</h1>
          <p className="home-description">
            Elige un juego, crea una sala y deja que todos entren desde su celular.
            La inteligencia artificial se encarga de que ninguna partida sea igual.
          </p>
          <div className="home-actions">
            <Link className="start-button home-primary" href="/games"><span>Elegir un juego</span><i>→</i></Link>
            <Link className="home-secondary" href="/join">Ya tengo un código</Link>
          </div>
        </div>
        <div className="home-party" aria-label="Personajes de Funbox listos para jugar">
          <div className="party-confetti" />
          {AVATAR_CATALOG.slice(0, 8).map((avatar, index) => (
            <div className={`home-character home-character-${index + 1}`} key={avatar.key}>
              <AvatarCharacter avatarKey={avatar.key} index={index} compact />
            </div>
          ))}
          <div className="home-party-sign"><small>Esta noche</small><strong>¡SE JUEGA!</strong></div>
        </div>
      </section>
    </main>
  );
}
