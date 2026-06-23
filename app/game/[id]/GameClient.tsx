"use client";

import { Fragment, useEffect, useState } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Chessboard } from "react-chessboard";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { loadSeat, type Seat } from "../../seat";
import { CopyButton, formatToken } from "../../token";

// The engine is intentionally NOT imported here — the server is authoritative
// and getGameView hands us exactly what we're allowed to see. The client only
// needs trivial square/piece helpers and the view type (derived from the API).

type GameView = NonNullable<FunctionReturnType<typeof api.games.getGameView>>;
type BoardProps = ComponentProps<typeof Chessboard>;

const FILES = "abcdefgh";
const idxToSquare = (i: number) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}`;
const squareToIdx = (s: string) => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
const pieceCode = (p: { color: "w" | "b"; type: string }) => p.color + p.type.toUpperCase();

const PIECE_NAME: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};

const GLYPH: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
// Color-aware glyphs for the phase tray (your own pieces).
const GLYPHS: Record<"w" | "b", Record<string, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
// Sort order by value: pawn < knight < bishop < rook < queen (bishop just over knight).
const VALUE_ORDER: Record<string, number> = { p: 0, n: 1, b: 2, r: 3, q: 4 };

// cburnett piece set (lichess open standard, GPLv2+; SVGs in public/pieces/cburnett).
// Renders each piece as an SVG sized to the square, per DESIGN.md.
const PIECE_CODES = [
  "wP", "wN", "wB", "wR", "wQ", "wK",
  "bP", "bN", "bB", "bR", "bQ", "bK",
] as const;
const cburnettPieces = Object.fromEntries(
  PIECE_CODES.map((code) => [
    code,
    ({ squareWidth }: { squareWidth: number }) => (
      <img
        src={`/pieces/cburnett/${code}.svg`}
        alt={code}
        width={squareWidth}
        height={squareWidth}
        draggable={false}
        style={{ display: "block" }}
      />
    ),
  ]),
) as BoardProps["customPieces"];

/**
 * A fixed-height strip of captured pieces (half-size, value-sorted, kings
 * omitted). Height is reserved even when empty so the board never shifts.
 */
function CapturedTray({
  pieces,
  color,
  glyphSize,
}: {
  pieces: string[];
  color: "w" | "b";
  glyphSize: number;
}) {
  const sorted = pieces
    .filter((t) => t !== "k")
    .sort((a, b) => (VALUE_ORDER[a] ?? 0) - (VALUE_ORDER[b] ?? 0));
  return (
    <div
      style={{
        minHeight: glyphSize * 1.15,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "0 0.25rem",
      }}
    >
      {sorted.map((t, i) => (
        <span
          key={i}
          style={{
            fontSize: glyphSize,
            lineHeight: 1,
            // Distinguished by luminance (colorblind-safe), not hue.
            color: color === "w" ? "#edeff2" : "#7c8a99",
          }}
        >
          {GLYPH[t]}
        </span>
      ))}
    </div>
  );
}

/**
 * The move log. Reads the per-seat, fog-filtered notation from the server
 * (opponent phase-out durations show as "~?" until the game ends, then the true
 * log is revealed). Rendered as a classic two-column figurine move list; a turn's
 * move and any end-of-turn phase-ins share that player's cell.
 */
function MoveLog({ gameId, seatToken }: { gameId: Id<"games">; seatToken: string | undefined }) {
  const data = useQuery(api.games.getMoveLog, { gameId, seatToken });
  if (!data || data.log.length === 0) {
    return (
      <div className="panel">
        <strong>Moves</strong>
        <div className="muted" style={{ marginTop: "0.4rem" }}>No moves yet.</div>
      </div>
    );
  }

  // Group each ply's events (move + any phase-ins) into that player's cell.
  const rows = new Map<number, { w?: string; b?: string }>();
  for (const e of data.log) {
    const moveNo = Math.ceil(e.ply / 2);
    const row = rows.get(moveNo) ?? {};
    const prev = e.color === "w" ? row.w : row.b;
    const text = prev ? `${prev} ${e.fan}` : e.fan;
    if (e.color === "w") row.w = text;
    else row.b = text;
    rows.set(moveNo, row);
  }
  const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="panel">
      <strong>Moves</strong>
      <div className="movelog">
        {ordered.map(([n, r]) => (
          <Fragment key={n}>
            <span className="movelog-n">{n}.</span>
            <span>{r.w ?? ""}</span>
            <span>{r.b ?? ""}</span>
          </Fragment>
        ))}
      </div>
      {data.revealed && <div className="movelog-revealed">Full log revealed — game over.</div>}
    </div>
  );
}

/**
 * The phase tray — your hidden pieces, each as a glyph wrapped in a cyan countdown
 * ring (fraction = turns left / the piece type's max) with a turns-left badge.
 * This is the DESIGN.md signature: hidden-but-yours state lives here, off the
 * board, so the board stays clean.
 */
function PhaseTray({
  phased,
  color,
  rules,
}: {
  phased: GameView["yourPhased"];
  color: "w" | "b";
  rules: GameView["rules"];
}) {
  if (phased.length === 0) {
    return <div className="muted" style={{ marginTop: "0.4rem" }}>None.</div>;
  }
  return (
    <div className="phasetray">
      {phased.map((ph, i) => {
        const max = rules[ph.type] || 1;
        const frac = Math.max(0, Math.min(1, ph.turnsRemaining / max));
        return (
          <div
            key={i}
            className="pp"
            style={{ ["--deg" as string]: `${Math.round(frac * 360)}deg` } as CSSProperties}
            title={`${PIECE_NAME[ph.type]} → ${idxToSquare(ph.origin)}, returns in ${ph.turnsRemaining} turn${ph.turnsRemaining === 1 ? "" : "s"}`}
          >
            <span className="pp-ring" aria-hidden />
            <span className="pp-glyph">{GLYPHS[color][ph.type]}</span>
            <span className="pp-num">{ph.turnsRemaining}</span>
          </div>
        );
      })}
    </div>
  );
}

type MatchSummary = NonNullable<FunctionReturnType<typeof api.games.getMatchHistory>>[number];

function matchResultText(m: MatchSummary): string {
  if (m.status === "active") return "Unfinished";
  const winner = m.status === "w_won" ? "w" : "b";
  const sc = m.wonBySelfCapture ? " (self-capture)" : "";
  if (m.yourColor) return (m.yourColor === winner ? "You won" : "You lost") + sc;
  return (winner === "w" ? "White won" : "Black won") + sc;
}

/** Past finished games for this game's seats. Self-hides when there are none. */
function MatchHistory({
  gameId,
  seatToken,
  onWatch,
}: {
  gameId: Id<"games">;
  seatToken: string | undefined;
  onWatch: (matchId: Id<"matches">, color: "w" | "b" | null) => void;
}) {
  const matches = useQuery(api.games.getMatchHistory, { gameId, seatToken });
  if (!matches || matches.length === 0) return null;
  return (
    <div className="panel">
      <strong>Past games</strong>
      <ul className="history">
        {matches.map((m) => (
          <li key={m.matchId}>
            <span>
              {matchResultText(m)} <span className="muted">· {m.plies} plies</span>
            </span>
            <button onClick={() => onWatch(m.matchId, m.yourColor)}>Watch</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const REPLAY_BOARD = 380;

/** Watch an archived game frame-by-frame, with a fog perspective toggle. */
function ReplayOverlay({
  matchId,
  defaultColor,
  onClose,
}: {
  matchId: Id<"matches">;
  defaultColor: "w" | "b" | null;
  onClose: () => void;
}) {
  const [perspective, setPerspective] = useState<"w" | "b" | "full">(defaultColor ?? "full");
  const [idx, setIdx] = useState(0);
  const data = useQuery(api.games.getMatchReplay, { matchId, perspective });

  const frames = data?.frames ?? [];
  const total = frames.length;
  const cur = total ? Math.min(idx, total - 1) : 0;
  const frame = frames[cur];

  const position: Record<string, string> = {};
  const styles: Record<string, CSSProperties> = {};
  if (frame) {
    frame.board.forEach((p, i) => {
      if (p) position[idxToSquare(i)] = pieceCode(p);
    });
    for (const sq of frame.warningSquares) {
      styles[idxToSquare(sq)] = { outline: "3px dashed #ff8a3d", outlineOffset: "-3px" };
    }
    for (const ph of frame.phased) {
      styles[idxToSquare(ph.origin)] = {
        boxShadow: "inset 0 0 0 4px #27c2d8",
        background: "rgba(39,194,216,0.15)",
      };
    }
  }
  const otherColor = defaultColor === "w" ? "b" : "w";

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-card" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Replay</strong>
          <button onClick={onClose}>Close</button>
        </div>

        <div className="seg" role="group" aria-label="Replay perspective">
          {defaultColor && (
            <button className={perspective === defaultColor ? "on" : ""} onClick={() => setPerspective(defaultColor)}>
              Your view
            </button>
          )}
          {defaultColor && (
            <button className={perspective === otherColor ? "on" : ""} onClick={() => setPerspective(otherColor)}>
              Opponent
            </button>
          )}
          <button className={perspective === "full" ? "on" : ""} onClick={() => setPerspective("full")}>
            Full reveal
          </button>
        </div>

        {data === undefined ? (
          <div className="muted">Loading…</div>
        ) : data === null ? (
          <div className="muted">Replay not found.</div>
        ) : (
          <>
            <div style={{ width: REPLAY_BOARD, margin: "0 auto" }}>
              <Chessboard
                id="phase-chess-replay"
                position={position as BoardProps["position"]}
                boardWidth={REPLAY_BOARD}
                boardOrientation={perspective === "b" ? "black" : "white"}
                arePiecesDraggable={false}
                customPieces={cburnettPieces}
                customSquareStyles={styles as BoardProps["customSquareStyles"]}
                customBoardStyle={{ borderRadius: "8px" }}
                customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
                customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
              />
            </div>

            {frame && frame.phased.length > 0 && (
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Phased:{" "}
                {frame.phased.map((p, i) => (
                  <span key={i} style={{ marginRight: "0.7rem" }}>
                    {GLYPHS[p.color][p.type]} {idxToSquare(p.origin)}
                  </span>
                ))}
              </div>
            )}

            <div className="replay-controls">
              <button onClick={() => setIdx(0)} disabled={cur === 0}>⏮</button>
              <button onClick={() => setIdx(Math.max(0, cur - 1))} disabled={cur === 0}>◀</button>
              <span className="replay-frame">{cur} / {Math.max(0, total - 1)}</span>
              <button onClick={() => setIdx(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1}>▶</button>
              <button onClick={() => setIdx(total - 1)} disabled={cur >= total - 1}>⏭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function GameClient({ gameId }: { gameId: string }) {
  const id = gameId as Id<"games">;
  const router = useRouter();

  const makeMove = useMutation(api.games.makeMove);
  const phaseOut = useMutation(api.games.phaseOut);
  const newGame = useMutation(api.games.newGame);

  const [seat, setSeat] = useState<Seat | null>(null);
  const [noSeat, setNoSeat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phaseMode, setPhaseMode] = useState(false);
  const [phaseFrom, setPhaseFrom] = useState<number | null>(null);
  const [phaseDuration, setPhaseDuration] = useState(1);
  const [boardWidth, setBoardWidth] = useState(480);
  const [replay, setReplay] = useState<{ id: Id<"matches">; color: "w" | "b" | null } | null>(null);

  // Entry is via token on the splash; a direct visitor with no seat is sent back.
  useEffect(() => {
    const existing = loadSeat(id);
    if (existing) setSeat(existing);
    else {
      setNoSeat(true);
      router.replace("/");
    }
  }, [id, router]);

  useEffect(() => {
    const fit = () => setBoardWidth(Math.min(480, window.innerWidth - 40));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const view = useQuery(
    api.games.getGameView,
    seat ? { gameId: id, seatToken: seat.seatToken ?? undefined } : "skip",
  );

  if (noSeat) return <main className="wrap">Redirecting…</main>;
  if (!seat || view === undefined) return <main className="wrap">Loading…</main>;
  if (view === null) return <main className="wrap">Game not found.</main>;

  // --- board position (used by both the waiting and active screens) ---
  const position: Record<string, string> = {};
  view.board.forEach((p, i) => {
    if (p) position[idxToSquare(i)] = pieceCode(p);
  });

  // --- waiting room (before the opponent has joined) ---
  if (view.phase === "waiting") {
    return (
      <main className="wrap" style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
        <div>
          <Chessboard
            id="phase-chess"
            position={position as BoardProps["position"]}
            boardWidth={boardWidth}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: "8px", opacity: 0.85 }}
            customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
            customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
            customPieces={cburnettPieces}
          />
        </div>
        <aside style={{ display: "grid", gap: "1rem", minWidth: 260 }}>
          <div className="panel" style={{ borderColor: "var(--accent)", display: "grid", gap: "0.8rem" }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>Waiting for opponent to join…</div>
            {view.role === "initiator" && view.joinToken ? (
              <>
                <div className="muted">Share this token with your opponent:</div>
                <div className="row" style={{ alignItems: "center", gap: "0.7rem" }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.5rem", letterSpacing: "0.15em" }}>
                    {formatToken(view.joinToken)}
                  </span>
                  <CopyButton text={formatToken(view.joinToken)} />
                </div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  Sides are chosen at random when your opponent joins.
                </div>
              </>
            ) : (
              <div className="muted">The game hasn’t started yet.</div>
            )}
          </div>
        </aside>
      </main>
    );
  }

  // --- active game ---
  const myColor = view.you;
  const isPlayer = myColor === "w" || myColor === "b";
  const myTurn =
    view.status === "active" && isPlayer && myColor === view.turn && !!seat.seatToken;

  // --- square highlights (Lab Slate — color ALWAYS paired with a shape cue;
  // never color alone, per DESIGN.md: the primary user is colorblind) ---
  const styles: Record<string, CSSProperties> = {};
  // Opponent return warning: orange + DASHED outline (distinct shape).
  for (const sq of view.warningSquares) {
    styles[idxToSquare(sq)] = { outline: "3px dashed #ff8a3d", outlineOffset: "-3px" };
  }
  // Your phased-piece origin: cyan + SOLID border + tint (the "phase" vocabulary).
  for (const ph of view.yourPhased) {
    styles[idxToSquare(ph.origin)] = {
      boxShadow: "inset 0 0 0 4px #27c2d8",
      background: "rgba(39,194,216,0.15)",
    };
  }
  // Selected piece to phase: thick neutral border.
  if (phaseFrom !== null) {
    styles[idxToSquare(phaseFrom)] = { boxShadow: "inset 0 0 0 5px #d9e2ec" };
  }

  // --- handlers ---
  const onPieceDrop: NonNullable<BoardProps["onPieceDrop"]> = (source, target, piece) => {
    if (!myTurn || !seat.seatToken || phaseMode) return false;
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
    // Phase-eligibility comes from the game's ruleset, not a hardcoded list.
    if (!p || p.color !== myColor || (view.rules[p.type] ?? 0) === 0) {
      setPhaseFrom(null);
      return;
    }
    setPhaseFrom(squareToIdx(square));
    setPhaseDuration(1);
  };

  const confirmPhase = async () => {
    if (phaseFrom === null || !seat.seatToken) return;
    try {
      await phaseOut({ gameId: id, seatToken: seat.seatToken, from: phaseFrom, duration: phaseDuration });
      setError(null);
      setPhaseMode(false);
      setPhaseFrom(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startNewGame = async () => {
    if (!seat.seatToken) return;
    try {
      await newGame({ gameId: id, seatToken: seat.seatToken });
      setPhaseMode(false);
      setPhaseFrom(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selectedType = phaseFrom !== null ? view.board[phaseFrom]?.type : undefined;
  const selectedMax = selectedType ? view.rules[selectedType] || 1 : 1;

  // --- status text ---
  const colorName = (c: "w" | "b") => (c === "w" ? "White" : "Black");
  let status: string;
  if (view.status === "active") {
    status = myTurn
      ? "Your move"
      : isPlayer
        ? "Opponent's move"
        : `${colorName(view.turn)} to move`;
  } else {
    const winner = view.status === "w_won" ? "w" : "b";
    const loser = winner === "w" ? "b" : "w";
    const youWon = isPlayer && myColor === winner;
    if (view.wonBySelfCapture) {
      status = isPlayer
        ? youWon
          ? `${colorName(loser)} captured their own king — you win!`
          : "You captured your own king — you lose."
        : `${colorName(loser)} captured their own king — ${colorName(winner)} wins.`;
    } else {
      status = isPlayer
        ? youWon
          ? "You captured the king — you win!"
          : "Your king was captured — you lose."
        : `${colorName(winner)} won.`;
    }
  }

  // --- non-terminal self-capture notice ("X captured their own rook") ---
  const ev = view.lastEvent;
  const selfCaptureText =
    view.status === "active" && ev
      ? `${ev.by === myColor ? "You" : colorName(ev.by)} captured ${
          ev.by === myColor ? "your" : "their"
        } own ${(PIECE_NAME[ev.piece] ?? "piece").toLowerCase()} on ${idxToSquare(ev.square)}.`
      : null;

  // Captured-piece trays. Each player's captures sit behind their own back rank:
  // the bottom player's (their captures of the opponent) below the board, the
  // top player's above it. captured[X] holds X's lost pieces.
  const bottomColor: "w" | "b" = myColor === "b" ? "b" : "w";
  const topColor: "w" | "b" = bottomColor === "w" ? "b" : "w";
  const glyphSize = Math.round(boardWidth / 14);

  return (
    <main className="wrap" style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
      {view.status !== "active" && (
        <div
          className="panel"
          style={{
            gridColumn: "1 / -1",
            textAlign: "center",
            borderColor: "var(--accent)",
            display: "grid",
            gap: "0.9rem",
            padding: "1.5rem",
          }}
        >
          <div style={{ fontSize: "1.7rem", fontWeight: 700 }}>{status}</div>
          {isPlayer && (
            <div>
              <button
                className="primary"
                style={{ fontSize: "1.05rem", padding: "0.6rem 1.5rem" }}
                onClick={startNewGame}
              >
                New game
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ width: boardWidth }}>
        {/* Top tray: pieces the top player captured (the bottom player's losses). */}
        <CapturedTray pieces={view.captured[bottomColor]} color={bottomColor} glyphSize={glyphSize} />
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
          customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
          customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
          customPieces={cburnettPieces}
        />
        {/* Bottom tray: pieces the bottom player captured (the top player's losses). */}
        <CapturedTray pieces={view.captured[topColor]} color={topColor} glyphSize={glyphSize} />
      </div>

      <aside style={{ display: "grid", gap: "1rem", minWidth: 260 }}>
        <div className="panel">
          {view.status === "active" && (
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>{status}</div>
          )}
          <div className="muted" style={{ marginTop: view.status === "active" ? "0.3rem" : 0 }}>
            You are{" "}
            {myColor === "w" ? "White" : myColor === "b" ? "Black" : "a spectator"}.
          </div>
        </div>

        <div className="panel">
          <strong>Rules</strong>
          <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.9rem" }}>
            {(() => {
              const order: Array<[keyof GameView["rules"], string]> = [
                ["p", "Pawn"], ["n", "Knight"], ["b", "Bishop"],
                ["r", "Rook"], ["q", "Queen"], ["k", "King"],
              ];
              const phaseable = order.filter(([t]) => view.rules[t] > 0);
              return phaseable.length === 0
                ? "No pieces can phase."
                : phaseable.map(([t, name]) => `${name} ≤${view.rules[t]}`).join(" · ");
            })()}
          </div>
        </div>

        {selfCaptureText && (
          <div className="panel" style={{ color: "var(--danger)" }}>{selfCaptureText}</div>
        )}

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
                      It stays out through your turn(s) and returns to {idxToSquare(phaseFrom)} at
                      the end of the last one, removing whatever is there — your own pieces included.
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
            <PhaseTray phased={view.yourPhased} color={myColor === "b" ? "b" : "w"} rules={view.rules} />
            {view.warningSquares.length > 0 && (
              <div style={{ marginTop: "0.6rem", color: "var(--warning)" }}>
                ⚠ An opponent piece returns next turn (dashed square).
              </div>
            )}
          </div>
        )}

        <MoveLog gameId={id} seatToken={seat.seatToken ?? undefined} />

        <MatchHistory
          gameId={id}
          seatToken={seat.seatToken ?? undefined}
          onWatch={(matchId, color) => setReplay({ id: matchId, color })}
        />

        {/* Players can invite spectators with the token; spectators don't get it. */}
        {view.joinToken && (
          <div className="panel">
            <strong>Invite spectators</strong>
            <div className="row" style={{ marginTop: "0.5rem", alignItems: "center", gap: "0.7rem" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "1.15rem", letterSpacing: "0.12em" }}>
                {formatToken(view.joinToken)}
              </span>
              <CopyButton text={formatToken(view.joinToken)} />
            </div>
            <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
              Anyone with this token can watch the game.
            </div>
          </div>
        )}

        {error && <div className="panel" style={{ color: "var(--danger)" }}>{error}</div>}
      </aside>

      {replay && (
        <ReplayOverlay
          matchId={replay.id}
          defaultColor={replay.color}
          onClose={() => setReplay(null)}
        />
      )}
    </main>
  );
}
