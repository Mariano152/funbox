import { notFound } from "next/navigation";
import { GAME_CATALOG, getGame } from "@/features/games/game-catalog";
import { GameSetupPage } from "@/features/games/GameSetupPage";

export function generateStaticParams() {
  return GAME_CATALOG.map((game) => ({ gameKey: game.key }));
}

export default async function Page({ params }: { params: Promise<{ gameKey: string }> }) {
  const { gameKey } = await params;
  const game = getGame(gameKey);
  if (!game) notFound();
  return <GameSetupPage game={game} />;
}
