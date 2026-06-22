"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { saveSeat } from "./seat";
import { ChunkedTokenInput } from "./token";

export default function Home() {
  const createGame = useMutation(api.games.createGame);
  const joinByToken = useMutation(api.games.joinByToken);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [token, setToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [spectatorGame, setSpectatorGame] = useState<string | null>(null);

  const onNewGame = async () => {
    setBusy(true);
    try {
      const { gameId, seatToken } = await createGame({});
      saveSeat(gameId, { seatToken });
      router.push(`/game/${gameId}`);
    } catch (e) {
      setBusy(false);
      alert(`Could not create a game: ${(e as Error).message}`);
    }
  };

  const openJoin = () => {
    setShowJoin(true);
    setToken("");
    setJoinError(null);
    setSpectatorGame(null);
  };

  const onJoin = async () => {
    if (token.length < 8) {
      setJoinError("Enter the full 8-character token.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const { gameId, role, seatToken } = await joinByToken({ token });
      saveSeat(gameId, { seatToken });
      if (role === "spectator") {
        // Inform the user before sending them in as a spectator.
        setJoining(false);
        setSpectatorGame(gameId);
        return;
      }
      router.push(`/game/${gameId}`);
    } catch (e) {
      setJoining(false);
      setJoinError((e as Error).message);
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
        <p style={{ marginTop: 0 }}>
          Start a game and share the token, or join one with a token you were given.
        </p>
        <div className="row">
          <button className="primary" onClick={onNewGame} disabled={busy}>
            {busy ? "Creating…" : "New Game"}
          </button>
          <button onClick={openJoin} disabled={busy}>
            Join Game
          </button>
        </div>
      </div>

      {showJoin && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: "1rem",
          }}
          onClick={() => setShowJoin(false)}
        >
          <div
            className="panel"
            style={{ maxWidth: 380, width: "100%", display: "grid", gap: "0.9rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {spectatorGame ? (
              <>
                <strong>This game is already in progress.</strong>
                <p className="muted" style={{ margin: 0 }}>
                  Both seats are taken — you’ll join as a spectator.
                </p>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button onClick={() => setShowJoin(false)}>Cancel</button>
                  <button className="primary" onClick={() => router.push(`/game/${spectatorGame}`)}>
                    Watch
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>Enter the game token</strong>
                <ChunkedTokenInput value={token} onChange={setToken} onEnter={onJoin} autoFocus />
                {joinError && <div style={{ color: "var(--danger)" }}>{joinError}</div>}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button onClick={() => setShowJoin(false)}>Cancel</button>
                  <button className="primary" onClick={onJoin} disabled={joining}>
                    {joining ? "Joining…" : "Join"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
