export const GAME_CATALOG = [
  { key: "wheres-waldo", name: "¿Dónde está Gelito?", description: "Encuentra al personaje correcto antes que todos los demás.", category: "Observación", players: "2–8", duration: "10 min", accent: "pink", icon: "◎" },
  { key: "guess-the-song", name: "Adivina la canción", description: "Reconoce canciones con pistas, fragmentos y ocurrencias de la IA.", category: "Música", players: "2–8", duration: "15 min", accent: "purple", icon: "♫" },
  { key: "act-it-out", name: "¡Actúalo!", description: "La IA propone escenas absurdas y tu equipo intenta adivinarlas.", category: "Actuación", players: "3–8", duration: "15 min", accent: "cyan", icon: "★" },
  { key: "trivia", name: "Cultura gelatinosa", description: "Preguntas de cultura general que se adaptan al nivel de la fiesta.", category: "Trivia", players: "2–8", duration: "12 min", accent: "lime", icon: "?" },
  { key: "draw-it", name: "Dibuja el desastre", description: "Dibuja desde tu celular y descubre quién entendió la consigna.", category: "Dibujo", players: "3–8", duration: "15 min", accent: "orange", icon: "✎" },
  { key: "guess-who", name: "Adivina quién", description: "Haz preguntas inteligentes para descubrir al personaje secreto.", category: "Deducción", players: "2–8", duration: "12 min", accent: "blue", icon: "◇" },
  { key: "same-answer", name: "No pongas lo mismo", description: "Responde rápido, pero evita coincidir con cualquiera de tus amigos.", category: "Palabras", players: "3–8", duration: "10 min", accent: "red", icon: "≠" },
  { key: "secret-word", name: "Palabra infiltrada", description: "Consigue que digan tu palabra secreta durante toda la partida.", category: "Engaño", players: "3–8", duration: "20 min", accent: "teal", icon: "⌁" },
] as const;

export type GameDefinition = (typeof GAME_CATALOG)[number];

export function getGame(gameKey: string) {
  return GAME_CATALOG.find((game) => game.key === gameKey);
}
