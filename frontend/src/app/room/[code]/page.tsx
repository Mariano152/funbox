import { PlayerRoomPage } from "@/features/rooms/PlayerRoomPage";

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <PlayerRoomPage code={code.toUpperCase()} />;
}
