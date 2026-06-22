"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { saveSeat } from "./seat";

export default function Home() {
  const createGame = useMutation(api.games.createGame);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    setBusy(true);
    try {
      const { gameId, color, seatToken } = await createGame({});
      saveSeat(gameId, { color, seatToken });
      router.push(`/game/${gameId}`);
    } catch (e) {
      setBusy(false);
      alert(`Could not create a game: ${(e as Error).message}`);
    }
  };

  return (
    <main className="wrap">
      <h1 style={{ marginBottom: "0.25rem" }}>Phase Chess</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 620 }}>
        A fog-of-war chess variant. Any non-pawn piece can <strong>phase out</strong> — leave
        the board for a few turns and reappear on its square, removing whatever sits there
        (your own pieces included). You see your phased pieces and their timers; your opponent
        only gets a one-turn warning before a piece returns. There is no checkmate:{" "}
        <strong>capture the king to win.</strong>
      </p>
      <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 420 }}>
        <p style={{ marginTop: 0 }}>Start a game, then share the link with your opponent.</p>
        <button className="primary" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create a game"}
        </button>
      </div>
    </main>
  );
}
