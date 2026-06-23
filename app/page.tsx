"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { clearPending, loadPending, loadSeat, savePending, saveSeat } from "./seat";
import { ChunkedTokenInput, CopyButton, formatToken } from "./token";

type PieceKey = "p" | "n" | "b" | "r" | "q" | "k";
const PIECE_ROWS: Array<[PieceKey, string]> = [
  ["p", "Pawn"],
  ["n", "Knight"],
  ["b", "Bishop"],
  ["r", "Rook"],
  ["q", "Queen"],
  ["k", "King"],
];
// Standard Phase Chess ruleset (mirrors the engine's DEFAULT_RULE_CONFIG).
const STANDARD_RULES: Record<PieceKey, number> = { p: 0, n: 2, b: 2, r: 3, q: 4, k: 1 };
const MAX_RULE_DURATION = 8;

export default function Home() {
  const createGame = useMutation(api.games.createGame);
  const joinByToken = useMutation(api.games.joinByToken);
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [rules, setRules] = useState<Record<PieceKey, number>>(STANDARD_RULES);
  const [showJoin, setShowJoin] = useState(false);
  const [token, setToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [spectatorGame, setSpectatorGame] = useState<string | null>(null);

  // A game the initiator created and is waiting on. We stay on the splash and
  // only go to the board once an opponent joins (so they never see the board —
  // or a color that might flip — before the game actually starts).
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => setPendingId(loadPending()), []);

  const pendingSeat = pendingId ? loadSeat(pendingId) : null;
  const pendingView = useQuery(
    api.games.getGameView,
    pendingId && pendingSeat
      ? { gameId: pendingId as Id<"games">, seatToken: pendingSeat.seatToken ?? undefined }
      : "skip",
  );

  useEffect(() => {
    if (!pendingId || pendingView === undefined) return;
    if (pendingView === null) {
      clearPending();
      setPendingId(null);
    } else if (pendingView.phase === "active") {
      clearPending();
      router.push(`/game/${pendingId}`);
    }
  }, [pendingId, pendingView, router]);

  const onNewGame = async () => {
    setBusy(true);
    try {
      const { gameId, seatToken } = await createGame({ config: { maxPhaseDuration: rules } });
      saveSeat(gameId, { seatToken });
      savePending(gameId);
      setPendingId(gameId);
      setShowSettings(false);
    } catch (e) {
      alert(`Could not create a game: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const setDuration = (t: PieceKey, delta: number) =>
    setRules((r) => ({ ...r, [t]: Math.max(0, Math.min(MAX_RULE_DURATION, r[t] + delta)) }));

  const cancelWaiting = () => {
    clearPending();
    setPendingId(null);
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

  // --- waiting room (stays on the splash) ---
  if (pendingId && pendingView && pendingView.phase === "waiting") {
    const code = pendingView.joinToken ? formatToken(pendingView.joinToken) : "";
    return (
      <main className="wrap">
        <h1 style={{ marginBottom: "0.25rem" }}>Phase Chess</h1>
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 460, display: "grid", gap: "0.9rem", borderColor: "var(--accent)" }}>
          <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>Waiting for opponent to join…</div>
          <div className="muted">Share this token with your opponent:</div>
          <div className="row" style={{ alignItems: "center", gap: "0.7rem" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.8rem", letterSpacing: "0.15em" }}>
              {code}
            </span>
            <CopyButton text={code} />
          </div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Sides are chosen at random when they join. You’ll go to the board automatically.
          </div>
          <div>
            <button onClick={cancelWaiting}>Cancel</button>
          </div>
        </div>
      </main>
    );
  }

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

      {showSettings ? (
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 460, display: "grid", gap: "0.8rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>Game rules</strong>
            <button style={{ fontSize: "0.85rem" }} onClick={() => setRules(STANDARD_RULES)}>
              Standard
            </button>
          </div>
          <div className="muted" style={{ fontSize: "0.88rem" }}>
            Max turns each piece may phase out (0 = can&rsquo;t phase). Both players see these.
          </div>
          <div style={{ display: "grid", gap: "0.45rem" }}>
            {PIECE_ROWS.map(([t, name]) => (
              <div key={t} className="row" style={{ justifyContent: "space-between" }}>
                <span>{name}</span>
                <div className="row" style={{ gap: "0.4rem" }}>
                  <button onClick={() => setDuration(t, -1)} disabled={rules[t] <= 0} aria-label={`Decrease ${name}`}>
                    −
                  </button>
                  <span className="mono" style={{ minWidth: "1.5em", textAlign: "center" }}>
                    {rules[t] === 0 ? "—" : rules[t]}
                  </span>
                  <button onClick={() => setDuration(t, 1)} disabled={rules[t] >= MAX_RULE_DURATION} aria-label={`Increase ${name}`}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.2rem" }}>
            <button onClick={() => setShowSettings(false)} disabled={busy}>Cancel</button>
            <button className="primary" onClick={onNewGame} disabled={busy}>
              {busy ? "Creating…" : "Create game"}
            </button>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ marginTop: "1.5rem", maxWidth: 420 }}>
          <p style={{ marginTop: 0 }}>
            Start a game and share the token, or join one with a token you were given.
          </p>
          <div className="row">
            <button className="primary" onClick={() => setShowSettings(true)} disabled={busy}>
              New Game
            </button>
            <button onClick={openJoin} disabled={busy}>
              Join Game
            </button>
          </div>
        </div>
      )}

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
