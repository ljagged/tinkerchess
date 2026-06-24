import { GameClient } from "./GameClient";

// Next 15+ makes route `params` a Promise (resolved server-side before render).
export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameClient gameId={id} />;
}
