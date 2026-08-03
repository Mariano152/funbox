import { DjPage } from "@/features/music/DjPage";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <DjPage code={code.toUpperCase()} />;
}
