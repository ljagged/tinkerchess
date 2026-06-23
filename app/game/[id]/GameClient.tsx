"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
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

// JohnPablok's modified cburnett set (CC-BY-SA 3.0; SVGs in public/pieces/johnpablok).
// Pawns are slightly smaller relative to the back row, and black pieces carry a
// white outline so they stay legible on the dark squares (a colorblind-contrast
// win — see DESIGN.md). Two variants ship: "flat" and "shadow" (drop shadow).
// A player-facing toggle is deferred to settings; for now flip PIECE_VARIANT to
// switch the whole board. Flat is the default to match the flat Lab Slate look.
type PieceVariant = "flat" | "shadow";
const PIECE_VARIANT: PieceVariant = "flat";
const PIECE_CODES = [
  "wP", "wN", "wB", "wR", "wQ", "wK",
  "bP", "bN", "bB", "bR", "bQ", "bK",
] as const;
// JohnPablok's glyphs sit larger in their viewBox than cburnett did, so render
// each at 90% of the square (centered) to restore comfortable breathing room.
const PIECE_SCALE = 0.9;
const pieceSet = (variant: PieceVariant) =>
  Object.fromEntries(
    PIECE_CODES.map((code) => [
      code,
      ({ squareWidth }: { squareWidth: number }) => (
        <div
          style={{
            width: squareWidth,
            height: squareWidth,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={`/pieces/johnpablok/${variant}/${code}.svg`}
            alt={code}
            width={squareWidth * PIECE_SCALE}
            height={squareWidth * PIECE_SCALE}
            draggable={false}
            style={{ display: "block" }}
          />
        </div>
      ),
    ]),
  ) as BoardProps["customPieces"];
// Prebuild both so a future settings toggle is a cheap lookup, not a re-map.
const PIECE_SETS: Record<PieceVariant, BoardProps["customPieces"]> = {
  flat: pieceSet("flat"),
  shadow: pieceSet("shadow"),
};
const boardPieces = PIECE_SETS[PIECE_VARIANT];

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
            // Outline (white) vs solid (black) glyph = a shape cue, not just hue;
            // paired with the "You"/"Opponent" row label (colorblind-safe).
            color: color === "w" ? "#edeff2" : "#9aa7b4",
          }}
        >
          {GLYPHS[color][t]}
        </span>
      ))}
    </div>
  );
}

/**
 * The move log. Reads the per-seat, fog-filtered notation from the server
 * (opponent phase-out durations show as "↑?" until the game ends, then the true
 * log is revealed). Rendered as a classic two-column algebraic move list (SAN +
 * the ↑/↓ phase grammar); a turn's move and any end-of-turn phase-ins share that
 * player's cell.
 */
function MoveLog({ gameId, seatToken }: { gameId: Id<"games">; seatToken: string | undefined }) {
  const data = useQuery(api.games.getMoveLog, { gameId, seatToken });
  const logRef = useRef<HTMLDivElement>(null);
  const count = data?.log.length ?? 0;

  // Scroll the freshest move into view as the game progresses.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  if (!data || data.log.length === 0) {
    return (
      <div className="panel moves-panel">
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
    const text = prev ? `${prev} ${e.san}` : e.san;
    if (e.color === "w") row.w = text;
    else row.b = text;
    rows.set(moveNo, row);
  }
  const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="panel moves-panel">
      <strong>Moves</strong>
      <div className="movelog" ref={logRef}>
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

// Live board sizing (px). Bigger default than before; user can drag-resize within
// these bounds and the choice persists. Actual width is also clamped to the column.
const BOARD_MIN = 320;
const BOARD_CAP = 900;
const BOARD_DEFAULT = 720;
const GUTTER = 22; // coordinate gutter width

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
                customPieces={boardPieces}
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

/** Players-only in-game chat. Live via Convex; private to the two seats. */
function Chat({ gameId, seatToken }: { gameId: Id<"games">; seatToken: string }) {
  const messages = useQuery(api.games.getMessages, { gameId, seatToken });
  const send = useMutation(api.games.sendMessage);
  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows or arrives.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    send({ gameId, seatToken, text: t }).catch(() => {});
  };

  return (
    <div className="panel chat-panel">
      <strong>Chat</strong>
      <div className="chat-log" ref={logRef}>
        {messages && messages.length === 0 && (
          <div className="muted" style={{ fontSize: "0.85rem" }}>No messages yet.</div>
        )}
        {(messages ?? []).map((m) => (
          <div key={m.id} className={m.mine ? "chat-msg mine" : "chat-msg"}>
            <span className="chat-who">{m.mine ? "You" : "Opponent"}</span>
            {m.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="row"
        style={{ gap: "0.4rem", marginTop: "0.5rem", flexWrap: "nowrap" }}
      >
        <input
          className="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message your opponent…"
          maxLength={500}
          aria-label="Chat message"
        />
        <button className="primary" type="submit">Send</button>
      </form>
    </div>
  );
}

/**
 * On-board fog cues drawn over the board (DESIGN.md): your phased pieces appear as a
 * faint cyan ghost (dashed box + glyph + countdown) on their return square — visible
 * only to you — and an opponent's one-turn return warning pulses as an orange ring,
 * square only. pointer-events: none keeps the board interactive underneath.
 */
function BoardOverlay({
  boardWidth,
  orientation,
  phased,
  warnings,
  color,
}: {
  boardWidth: number;
  orientation: "white" | "black";
  phased: GameView["yourPhased"];
  warnings: number[];
  color: "w" | "b";
}) {
  const cell = boardWidth / 8;
  const place = (sq: number) => {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    const col = orientation === "black" ? 7 - file : file;
    const row = orientation === "black" ? rank : 7 - rank;
    return { left: col * cell, top: row * cell, width: cell, height: cell };
  };
  return (
    <div className="board-overlay">
      {warnings.map((sq) => (
        <div key={`w${sq}`} className="ov-cell ov-warn" style={place(sq)} />
      ))}
      {phased.map((ph, i) => (
        <div
          key={`g${i}`}
          className="ov-cell ov-ghost"
          style={{ ...place(ph.origin), fontSize: cell * 0.62 }}
        >
          <span className="ov-ghost-glyph">{GLYPHS[color][ph.type]}</span>
          <span className="ov-ghost-num">{ph.turnsRemaining}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A discreet icon button that toggles a small popover (Rules, Spectator invite).
 * Closes on outside click or Escape so it never clutters the board.
 */
function IconPopover({
  icon,
  label,
  align = "right",
  children,
}: {
  icon: string;
  label: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button
        className="icon-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className={`popover popover-${align}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The on-board phase dialog: right-clicking an eligible piece opens this over its
 * square. A 1–n slider picks the duration (n = the piece's max from the ruleset);
 * clicking anywhere off the box cancels (handled by the parent).
 */
function PhasePopover({
  left,
  top,
  type,
  square,
  max,
  duration,
  setDuration,
  onConfirm,
}: {
  left: number;
  top: number;
  type: string;
  square: string;
  max: number;
  duration: number;
  setDuration: (d: number) => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="phase-pop"
      style={{ left, top }}
      role="dialog"
      aria-label={`Phase out ${PIECE_NAME[type]} on ${square}`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="phase-pop-title">
        {GLYPH[type]} {PIECE_NAME[type]} · {square}
      </div>
      {max > 1 ? (
        <input
          type="range"
          min={1}
          max={max}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          aria-label="Turns to phase out"
          className="phase-slider"
        />
      ) : null}
      <div className="phase-pop-row">
        <span className="mono">
          {duration} turn{duration > 1 ? "s" : ""}
        </span>
        <button className="primary" onClick={onConfirm}>
          Phase out
        </button>
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
  const [phaseFrom, setPhaseFrom] = useState<number | null>(null);
  const [phaseDuration, setPhaseDuration] = useState(1);
  const [replay, setReplay] = useState<{ id: Id<"matches">; color: "w" | "b" | null } | null>(null);

  // Board sizing: the board fills its column up to a user-set max (drag handle,
  // persisted) and is clamped to whatever the column actually offers. This makes
  // it bigger than before, responsive to the window, and resizable like lichess.
  const [boardMax, setBoardMax] = useState(BOARD_DEFAULT);
  const [availWidth, setAvailWidth] = useState(BOARD_DEFAULT);
  const roRef = useRef<ResizeObserver | null>(null);
  const setBoardCol = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setAvailWidth(el.clientWidth));
    ro.observe(el);
    roRef.current = ro;
    setAvailWidth(el.clientWidth);
  }, []);

  // Entry is via token on the splash; a direct visitor with no seat is sent back.
  useEffect(() => {
    const existing = loadSeat(id);
    if (existing) setSeat(existing);
    else {
      setNoSeat(true);
      router.replace("/");
    }
  }, [id, router]);

  // Restore the saved board size, then persist any change (incl. drag).
  useEffect(() => {
    const s = Number(localStorage.getItem("phasechess:boardMax"));
    if (s) setBoardMax(Math.min(BOARD_CAP, Math.max(BOARD_MIN, s)));
  }, []);
  useEffect(() => {
    localStorage.setItem("phasechess:boardMax", String(boardMax));
  }, [boardMax]);

  // While a phase popover is open, a click anywhere off the box cancels it.
  useEffect(() => {
    if (phaseFrom === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".phase-pop")) setPhaseFrom(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [phaseFrom]);

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
            boardWidth={460}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: "8px", opacity: 0.85 }}
            customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
            customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
            customPieces={boardPieces}
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

  // Final board width: as big as the column allows, capped by the user's choice.
  const boardWidth = Math.max(BOARD_MIN, Math.min(boardMax, availWidth - GUTTER - 8));

  // --- square highlights. The fog cues (your phased ghost, opponent warning) are
  // drawn by BoardOverlay below as on-board shapes (DESIGN.md). Here we only mark
  // the selected piece. Color is always paired with a shape cue (colorblind-safe).
  const styles: Record<string, CSSProperties> = {};
  if (phaseFrom !== null) {
    styles[idxToSquare(phaseFrom)] = { boxShadow: "inset 0 0 0 5px #d9e2ec" }; // selected
  }

  // Coordinate gutters (DESIGN.md) — labels outside the board, orientation-aware.
  const orient: "white" | "black" = myColor === "b" ? "black" : "white";
  const rankLabels = orient === "black"
    ? ["1", "2", "3", "4", "5", "6", "7", "8"]
    : ["8", "7", "6", "5", "4", "3", "2", "1"];
  const fileLabels = orient === "black"
    ? ["h", "g", "f", "e", "d", "c", "b", "a"]
    : ["a", "b", "c", "d", "e", "f", "g", "h"];

  // Pixel position of a square (top-left), orientation-aware — used to anchor the
  // phase popover over the right-clicked square.
  const cell = boardWidth / 8;
  const squarePos = (sq: number) => {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    const col = orient === "black" ? 7 - file : file;
    const row = orient === "black" ? rank : 7 - rank;
    return { left: col * cell, top: row * cell };
  };
  const POP_W = 212;
  const POP_H = 96;
  let popLeft = 0;
  let popTop = 0;
  if (phaseFrom !== null) {
    const pos = squarePos(phaseFrom);
    popLeft = Math.min(Math.max(0, pos.left + cell / 2 - POP_W / 2), Math.max(0, boardWidth - POP_W));
    popTop = pos.top + cell + 8;
    if (popTop + POP_H > boardWidth) popTop = Math.max(8, pos.top - POP_H - 8);
  }

  // --- handlers ---
  const onPieceDrop: NonNullable<BoardProps["onPieceDrop"]> = (source, target, piece) => {
    if (!myTurn || !seat.seatToken) return false;
    const isPawn = piece[1] === "P";
    const lastRank = target.endsWith("8") || target.endsWith("1");
    const promotion = isPawn && lastRank ? ("q" as const) : undefined;
    makeMove({
      gameId: id,
      seatToken: seat.seatToken,
      from: squareToIdx(source),
      to: squareToIdx(target),
      ...(promotion ? { promotion } : {}),
      requestId: crypto.randomUUID(), // reused by Convex on retry -> idempotent
      expectedPly: view.turnsTaken.w + view.turnsTaken.b,
    }).catch((e) => setError((e as Error).message));
    // Let the authoritative view drive the board; reject the optimistic drop.
    return false;
  };

  // Left-click a square: the only job here is to dismiss an open phase popover
  // (selecting/moving pieces is drag, phasing is right-click).
  const onSquareClick: NonNullable<BoardProps["onSquareClick"]> = () => {
    if (phaseFrom !== null) setPhaseFrom(null);
  };

  // Right-click your own eligible piece to phase it out (less misfire-prone than
  // double-click). Opens the on-board slider popover over that square.
  const onSquareRightClick: NonNullable<BoardProps["onSquareRightClick"]> = (square) => {
    if (!myTurn || !seat.seatToken) return;
    const idx = squareToIdx(square);
    const p = view.board[idx];
    // Phase-eligibility comes from the game's ruleset, not a hardcoded list.
    if (!p || p.color !== myColor || (view.rules[p.type] ?? 0) === 0) {
      setPhaseFrom(null);
      return;
    }
    setPhaseFrom(idx);
    setPhaseDuration(1);
  };

  const confirmPhase = async () => {
    if (phaseFrom === null || !seat.seatToken) return;
    try {
      await phaseOut({
        gameId: id,
        seatToken: seat.seatToken,
        from: phaseFrom,
        duration: phaseDuration,
        requestId: crypto.randomUUID(),
        expectedPly: view.turnsTaken.w + view.turnsTaken.b,
      });
      setError(null);
      setPhaseFrom(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startNewGame = async () => {
    if (!seat.seatToken) return;
    try {
      await newGame({ gameId: id, seatToken: seat.seatToken });
      setPhaseFrom(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Drag the corner handle to resize the board; the choice persists.
  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = boardWidth;
    const move = (ev: PointerEvent) => {
      const next = Math.max(BOARD_MIN, Math.min(BOARD_CAP, startW + (ev.clientX - startX)));
      setBoardMax(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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

  // Player names (entered at create/join). Fall back to You/Opponent for the
  // viewer's seats, or White/Black for a spectator.
  const names = view.players;
  const bottomLabel = names[bottomColor] ?? (isPlayer ? "You" : colorName(bottomColor));
  const topLabel = names[topColor] ?? (isPlayer ? "Opponent" : colorName(topColor));

  // Phase ruleset, formatted once for the Rules popover.
  const rulesOrder: Array<[keyof GameView["rules"], string]> = [
    ["p", "Pawn"], ["n", "Knight"], ["b", "Bishop"],
    ["r", "Rook"], ["q", "Queen"], ["k", "King"],
  ];
  const phaseable = rulesOrder.filter(([t]) => view.rules[t] > 0);

  return (
    <main className="game">
      {view.status !== "active" && (
        <div className="gameover-banner panel">
          <div className="gameover-status">{status}</div>
          {isPlayer && (
            <button className="primary gameover-btn" onClick={startNewGame}>
              New game
            </button>
          )}
        </div>
      )}

      <div className="game-grid">
        {/* HEADER BAND — sits above the three aligned columns (phased / board /
            chat). Left header is empty; center holds Opponent + captured material;
            right holds the rules/spectator icons. This is what lines up the tops. */}
        <div className="col-head head-spacer" />
        <div className="col-head board-head">
          <div className="board-stack-head" style={{ width: GUTTER + boardWidth }}>
            <div className={`player-row ${!myTurn && view.status === "active" ? "to-move" : ""}`}>
              <span className="who">
                {topLabel}
                {!myTurn && view.status === "active" && <span className="move-dot" aria-hidden> ● to move</span>}
              </span>
              <CapturedTray pieces={view.captured[bottomColor]} color={bottomColor} glyphSize={glyphSize} />
            </div>
          </div>
        </div>
        <div className="col-head rail-head">
          <div className="rail-tools">
            <IconPopover icon="?" label="Rules" align="left">
              <strong>Phasing rules</strong>
              <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.9rem" }}>
                {phaseable.length === 0
                  ? "No pieces can phase."
                  : phaseable.map(([t, name]) => `${name} ≤${view.rules[t]}`).join(" · ")}
              </div>
              <div className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                Right-click a piece to phase it out. It returns to its square after the
                chosen number of your turns, removing whatever sits there. Capture the king to win.
              </div>
            </IconPopover>
            {view.joinToken && (
              <IconPopover icon="⤴" label="Invite spectators" align="left">
                <strong>Invite spectators</strong>
                <div className="row" style={{ marginTop: "0.5rem", alignItems: "center", gap: "0.7rem" }}>
                  <span className="token-code">{formatToken(view.joinToken)}</span>
                  <CopyButton text={formatToken(view.joinToken)} />
                </div>
                <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
                  Anyone with this token can watch.
                </div>
              </IconPopover>
            )}
          </div>
        </div>

        {/* LEFT RAIL — gameplay info: phased pieces (top), then the move list. */}
        <aside className="rail rail-left">
          {isPlayer && (
            <div className="panel phased-panel">
              <strong>Your phased pieces</strong>
              <PhaseTray phased={view.yourPhased} color={myColor === "b" ? "b" : "w"} rules={view.rules} />
              {view.warningSquares.length > 0 && (
                <div className="warn-line">
                  ⚠ An opponent piece returns next turn (dashed square on the board).
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
        </aside>

        {/* CENTER — the board, then your player row + captured material below it. */}
        <section className="board-col" ref={setBoardCol}>
          <div className="board-stack" style={{ width: GUTTER + boardWidth }}>
            <div
              className="board-frame"
              style={{
                gridTemplateColumns: `${GUTTER}px ${boardWidth}px`,
                gridTemplateRows: `${boardWidth}px ${GUTTER}px`,
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="board-ranks">
                {rankLabels.map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </div>
              <div className="board-wrap" style={{ width: boardWidth, height: boardWidth }}>
                <Chessboard
                  id="phase-chess"
                  position={position as BoardProps["position"]}
                  boardWidth={boardWidth}
                  boardOrientation={orient}
                  showBoardNotation={false}
                  arePiecesDraggable={myTurn}
                  isDraggablePiece={({ piece }) => myTurn && piece[0] === myColor}
                  onPieceDrop={onPieceDrop}
                  onSquareClick={onSquareClick}
                  onSquareRightClick={onSquareRightClick}
                  onPromotionCheck={() => false}
                  customSquareStyles={styles as BoardProps["customSquareStyles"]}
                  customBoardStyle={{ borderRadius: "8px" }}
                  customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
                  customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
                  customPieces={boardPieces}
                />
                <BoardOverlay
                  boardWidth={boardWidth}
                  orientation={orient}
                  phased={view.yourPhased}
                  warnings={view.warningSquares}
                  color={myColor === "b" ? "b" : "w"}
                />
                {phaseFrom !== null && selectedType && (
                  <PhasePopover
                    left={popLeft}
                    top={popTop}
                    type={selectedType}
                    square={idxToSquare(phaseFrom)}
                    max={selectedMax}
                    duration={phaseDuration}
                    setDuration={setPhaseDuration}
                    onConfirm={confirmPhase}
                  />
                )}
                <div
                  className="resize-handle"
                  onPointerDown={onHandleDown}
                  title="Drag to resize the board"
                  aria-hidden
                />
              </div>
              <div />
              <div className="board-files">
                {fileLabels.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            </div>

            <div className={`player-row ${myTurn ? "to-move" : ""}`}>
              <span className="who">
                {bottomLabel}
                {myTurn && <span className="move-dot" aria-hidden> ● to move</span>}
              </span>
              <CapturedTray pieces={view.captured[topColor]} color={topColor} glyphSize={glyphSize} />
            </div>
          </div>
          {isPlayer && view.status === "active" && (
            <p className="phase-hint">Right-click one of your pieces to phase it out.</p>
          )}
          <span className="sr-only" aria-live="polite">{status}</span>
        </section>

        {/* RIGHT RAIL — communication (the tool icons live in the header above). */}
        <aside className="rail rail-right">
          {isPlayer && seat.seatToken && <Chat gameId={id} seatToken={seat.seatToken} />}
        </aside>
      </div>

      {/* Transient notices float as toasts so the rails never reflow. */}
      {(selfCaptureText || error) && (
        <div className="toast-area">
          {selfCaptureText && <div className="toast">{selfCaptureText}</div>}
          {error && <div className="toast toast-danger" role="alert">{error}</div>}
        </div>
      )}

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
