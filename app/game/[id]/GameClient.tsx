"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { loadSeat, saveSeat, type Seat } from "../../seat";

// The engine is intentionally NOT imported here — the server is authoritative
// and getGameView hands us exactly what we're allowed to see. The client only
// needs trivial square/piece helpers and the view type (derived from the API).

type GameView = NonNullable<FunctionReturnType<typeof api.games.getGameView>>;
type BoardProps = ComponentProps<typeof Chessboard>;

const FILES = "abcdefgh";
const idxToSquare = (i: number) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}`;
const squareToIdx = (s: string) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
const pieceCode = (p: { color: "w" | "b"; type: string }) => p.color + p.type.toUpperCase();

const MAX_PHASE: Record<string, number> = { n: 2, b: 2, r: 3, q: 4, k: 1 };
const PIECE_NAME: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

export function GameClient({ gameId }: { gameId: string }) {
  const id = gameId as Id<"games">;

  const joinGame = useMutation(api.games.joinGame);
  const makeMove = useMutation(api.games.makeMove);
  const phaseOut = useMutation(api.games.phaseOut);

  const [seat, setSeat] = useState<Seat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phaseMode, setPhaseMode] = useState(false);
  const [phaseFrom, setPhaseFrom] = useState<number | null>(null);
  const [phaseDuration, setPhaseDuration] = useState(1);
  const [shareUrl, setShareUrl] = useState("");
  const [boardWidth, setBoardWidth] = useState(480);

  // Resolve our seat once: use the stored one, otherwise claim an open seat.
  const claiming = useRef(false);
  useEffect(() => {
    const existing = loadSeat(id);
    if (existing) {
      setSeat(existing);
      return;
    }
    if (claiming.current) return;
    claiming.current = true;
    joinGame({ gameId: id })
      .then((res) => {
        const s: Seat = { color: res.color, seatToken: res.seatToken };
        saveSeat(id, s);
        setSeat(s);
      })
      .catch((e) => setError((e as Error).message));
  }, [id, joinGame]);

  useEffect(() => {
    setShareUrl(window.location.href);
    const fit = () => setBoardWidth(Math.min(480, window.innerWidth - 40));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const view = useQuery(api.games.getGameView, {
    gameId: id,
    seatToken: seat?.seatToken ?? undefined,
  });

  if (view === undefined) return <main className="wrap">Loading…</main>;
  if (view === null) return <main className="wrap">Game not found.</main>;

  const myColor = seat?.color ?? "spectator";
  const isPlayer = myColor === "w" || myColor === "b";
  const myTurn =
    view.status === "active" && isPlayer && myColor === view.turn && !!seat?.seatToken;

  // --- board position ---
  const position: Record<string, string> = {};
  view.board.forEach((p, i) => {
    if (p) position[idxToSquare(i)] = pieceCode(p);
  });

  // --- square highlights ---
  const styles: Record<string, CSSProperties> = {};
  for (const sq of view.warningSquares) {
    styles[idxToSquare(sq)] = { boxShadow: "inset 0 0 0 4px rgba(210,101,79,0.85)" };
  }
  for (const ph of view.yourPhased) {
    styles[idxToSquare(ph.origin)] = {
      boxShadow: "inset 0 0 0 4px rgba(200,150,74,0.7)",
      background: "rgba(200,150,74,0.12)",
    };
  }
  if (phaseFrom !== null) {
    styles[idxToSquare(phaseFrom)] = { boxShadow: "inset 0 0 0 5px rgba(111,174,111,0.95)" };
  }

  // --- handlers ---
  const onPieceDrop: NonNullable<BoardProps["onPieceDrop"]> = (source, target, piece) => {
    if (!myTurn || !seat?.seatToken || phaseMode) return false;
    const isPawn = piece[1] === "P";
    const lastRank = target.endsWith("8") || target.endsWith("1");
    const promotion = isPawn && lastRank ? ("q" as const) : undefined;
    makeMove({
      gameId: id,
      seatToken: seat.seatToken,
      from: squareToIdx(source),
      to: squareToIdx(target),
      ...(promotion ? { promotion } : {}),
    }).catch((e) => setError((e as Error).message));
    // Let the authoritative view drive the board; reject the optimistic drop.
    return false;
  };

  const onSquareClick: NonNullable<BoardProps["onSquareClick"]> = (square) => {
    if (!phaseMode || !myTurn) return;
    const p = view.board[squareToIdx(square)];
    if (!p || p.color !== myColor || p.type === "p") {
      setPhaseFrom(null);
      return;
    }
    setPhaseFrom(squareToIdx(square));
    setPhaseDuration(1);
  };

  const confirmPhase = async () => {
    if (phaseFrom === null || !seat?.seatToken) return;
    try {
      await phaseOut({
        gameId: id,
        seatToken: seat.seatToken,
        from: phaseFrom,
        duration: phaseDuration,
      });
      setError(null);
      setPhaseMode(false);
      setPhaseFrom(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selectedType = phaseFrom !== null ? view.board[phaseFrom]?.type : undefined;
  const selectedMax = selectedType ? (MAX_PHASE[selectedType] ?? 1) : 1;

  // --- status text ---
  let status: string;
  if (view.status === "active") {
    status = myTurn ? "Your move" : isPlayer ? "Opponent's move" : "Spectating";
  } else {
    const youWon =
      (view.status === "w_won" && myColor === "w") ||
      (view.status === "b_won" && myColor === "b");
    status = isPlayer
      ? youWon
        ? "You captured the king — you win!"
        : "Your king was captured — you lose."
      : `${view.status === "w_won" ? "White" : "Black"} won.`;
  }

  return (
    <main className="wrap" style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
      <div>
        <Chessboard
          id="phase-chess"
          position={position as BoardProps["position"]}
          boardWidth={boardWidth}
          boardOrientation={myColor === "b" ? "black" : "white"}
          arePiecesDraggable={myTurn && !phaseMode}
          isDraggablePiece={({ piece }) => myTurn && !phaseMode && piece[0] === myColor}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          onPromotionCheck={() => false}
          customSquareStyles={styles as BoardProps["customSquareStyles"]}
          customBoardStyle={{ borderRadius: "8px" }}
        />
      </div>

      <aside style={{ display: "grid", gap: "1rem", minWidth: 260 }}>
        <div className="panel">
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{status}</div>
          <div className="muted" style={{ marginTop: "0.3rem" }}>
            You are{" "}
            {myColor === "w" ? "White" : myColor === "b" ? "Black" : "a spectator"}.
          </div>
        </div>

        {isPlayer && view.status === "active" && (
          <div className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Phasing</strong>
              <button
                onClick={() => {
                  setPhaseMode((m) => !m);
                  setPhaseFrom(null);
                }}
                disabled={!myTurn}
                className={phaseMode ? "primary" : ""}
              >
                {phaseMode ? "Cancel" : "Phase out a piece"}
              </button>
            </div>
            {phaseMode && (
              <div style={{ marginTop: "0.75rem" }}>
                {phaseFrom === null ? (
                  <span className="muted">Click one of your non-pawn pieces.</span>
                ) : (
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    <div>
                      {PIECE_NAME[selectedType ?? ""]} on{" "}
                      <strong>{idxToSquare(phaseFrom)}</strong> — phase out for:
                    </div>
                    <div className="row">
                      {Array.from({ length: selectedMax }, (_, k) => k + 1).map((d) => (
                        <button
                          key={d}
                          className={d === phaseDuration ? "primary" : ""}
                          onClick={() => setPhaseDuration(d)}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <button className="primary" onClick={confirmPhase}>
                      Phase out for {phaseDuration} turn{phaseDuration > 1 ? "s" : ""}
                    </button>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      It returns to {idxToSquare(phaseFrom)} automatically and removes whatever is
                      there — your own pieces included.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isPlayer && (
          <div className="panel">
            <strong>Your phased pieces</strong>
            {view.yourPhased.length === 0 ? (
              <div className="muted" style={{ marginTop: "0.4rem" }}>None.</div>
            ) : (
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
                {view.yourPhased.map((ph, i) => (
                  <li key={i}>
                    {PIECE_NAME[ph.type]} → {idxToSquare(ph.origin)}, returns in{" "}
                    {ph.turnsRemaining} turn{ph.turnsRemaining === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            )}
            {view.warningSquares.length > 0 && (
              <div style={{ marginTop: "0.6rem", color: "var(--danger)" }}>
                ⚠ An opponent piece returns next turn (highlighted).
              </div>
            )}
          </div>
        )}

        {/* Only players can invite — spectators don't see the link at all. */}
        {isPlayer && (
          <div className="panel">
            <strong>Share this game</strong>
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <input
                readOnly
                value={shareUrl}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "0.45rem 0.5rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text)",
                }}
              />
              <button onClick={() => navigator.clipboard?.writeText(shareUrl)}>Copy</button>
            </div>
            <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
              {view.blackOpen
                ? "Send it to your opponent — the first to open it plays Black."
                : "Send to anyone who will be a spectator."}
            </div>
          </div>
        )}

        {error && <div className="panel" style={{ color: "var(--danger)" }}>{error}</div>}
      </aside>
    </main>
  );
}
