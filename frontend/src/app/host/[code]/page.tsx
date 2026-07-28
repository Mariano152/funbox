import { LobbyPage } from "@/features/lobby/LobbyPage";

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <LobbyPage code={code.toUpperCase()} />;
}
