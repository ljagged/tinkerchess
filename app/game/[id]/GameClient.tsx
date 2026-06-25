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
import { errText } from "../../errors";
import { TimeControlPicker } from "../../TimeControlPicker";
import { remainingFor, DEFAULT_TIME_CONTROL, type TimeControlId } from "@/src/timecontrol";

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
    return <div className="movelog-empty muted">No moves yet.</div>;
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
  // Highlight the latest move (the "current" position; board-jump nav is deferred).
  const last = data.log[data.log.length - 1]!;
  const lastNo = Math.ceil(last.ply / 2);
  const lastColor = last.color;

  // Windowed list (recent moves are what matter mid-game); auto-scrolled to the
  // latest, scrollable for history, current move highlighted.
  return (
    <>
      <div className="movelog" ref={logRef}>
        {ordered.map(([n, r]) => (
          <Fragment key={n}>
            <span className="movelog-n">{n}.</span>
            <span className={n === lastNo && lastColor === "w" ? "cur" : ""}>{r.w ?? ""}</span>
            <span className={n === lastNo && lastColor === "b" ? "cur" : ""}>{r.b ?? ""}</span>
          </Fragment>
        ))}
      </div>
      {data.revealed && <div className="movelog-revealed">Full log — game over.</div>}
    </>
  );
}

/**
 * The phase return-queue (DESIGN.md fog pattern) — your hidden pieces as a compact
 * horizontal strip UNDER the board, ordered soonest-return first (left-most returns
 * next), each a cyan countdown ring + glyph + turns-left badge. Headed by a small
 * cyan ring icon, not a text label (the cyan vocabulary already says "phased/yours").
 * Its job is roster + return-order triage, which the scattered board ghosts can't
 * give at a glance. Collapses to nothing when you have no phased pieces.
 */
function PhaseQueue({
  phased,
  color,
  rules,
}: {
  phased: GameView["yourPhased"];
  color: "w" | "b";
  rules: GameView["rules"];
}) {
  if (phased.length === 0) return null;
  const sorted = [...phased].sort((a, b) => a.turnsRemaining - b.turnsRemaining);
  return (
    <div className="phase-queue" aria-label="Your phased pieces, soonest return first">
      <span className="phase-queue-icon" aria-hidden />
      <div className="phase-queue-row">
        {sorted.map((ph, i) => {
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
    </div>
  );
}

// Low-time threshold: under this we show tenths and switch on the urgent shape
// cue (bold + solid border), per DESIGN.md (never color alone).
const CLOCK_LOW_MS = 20_000;

/** Format remaining ms as M:SS, or S.t under 20s (tenths). Clamps at 0. */
function fmtClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < CLOCK_LOW_MS) {
    const tenths = Math.floor(clamped / 100);
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const totalSec = Math.floor(clamped / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

/**
 * A player's clock chip (DESIGN.md: monospace, active side emphasized). The
 * running side gets `.active`; low time pairs the danger color with a bold,
 * bordered shape cue (not color alone); an expired clock reads as `.flagged`.
 */
function Clock({ ms, active }: { ms: number; active: boolean }) {
  const low = ms < CLOCK_LOW_MS;
  const cls = ["clock", active ? "active" : "", low ? "low" : "", ms <= 0 ? "flagged" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} aria-label={`${active ? "Your clock, " : ""}time remaining ${fmtClock(ms)}`}>
      {fmtClock(ms)}
    </span>
  );
}

type LiveClockData = NonNullable<GameView["clock"]>;

/**
 * A self-contained ticking clock. It owns its OWN interval, so only this chip
 * re-renders 5×/sec while running — the board and rails stay still (the tick used
 * to live in GameClient and re-rendered the whole screen, jank on tablets). When
 * this side isn't the running side, it shows banked time and does no work.
 * `offsetMs` aligns the client to server time (serverNow − Date.now()).
 */
function LiveClock({
  clock,
  side,
  turn,
  offsetMs,
}: {
  clock: LiveClockData;
  side: "w" | "b";
  turn: "w" | "b";
  offsetMs: number;
}) {
  const running = clock.runningSince !== null && turn === side;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(handle);
  }, [running]);
  const ms = remainingFor(clock, side, turn, Date.now() + offsetMs);
  return <Clock ms={ms} active={running} />;
}

/**
 * Invisible watcher that claims the flag once the running clock crosses zero. It
 * polls at 1s (sub-second flag precision isn't needed) on its own interval, so it
 * doesn't re-render the board. The server re-checks authoritatively: a premature
 * claim returns a still-active view, and we RESET the guard so a genuinely-expired
 * clock is re-claimed on the next tick (a no-op is a success, not an error — the
 * earlier version latched the guard on it and stopped trying). Mounted only while
 * a clock is actually running and the viewer holds a seat.
 */
function TimeoutFlagger({
  clock,
  turn,
  offsetMs,
  gameId,
  seatToken,
}: {
  clock: LiveClockData;
  turn: "w" | "b";
  offsetMs: number;
  gameId: Id<"games">;
  seatToken: string;
}) {
  const flagTimeout = useMutation(api.games.flagTimeout);
  const sentRef = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(handle);
  }, []);
  // New running period (a move switched sides) → allow a fresh claim.
  useEffect(() => {
    sentRef.current = false;
  }, [clock.runningSince, turn]);
  useEffect(() => {
    if (sentRef.current) return;
    if (remainingFor(clock, turn, turn, Date.now() + offsetMs) > 0) return;
    sentRef.current = true;
    flagTimeout({ gameId, seatToken })
      .then((v) => {
        // Server says still active (our estimate was early) → retry next tick.
        if (v && v.status === "active") sentRef.current = false;
      })
      .catch(() => {
        sentRef.current = false;
      });
  }, [tick, clock, turn, offsetMs, flagTimeout, gameId, seatToken]);
  return null;
}

type MatchSummary = NonNullable<FunctionReturnType<typeof api.games.getMatchHistory>>[number];

function matchResultText(m: MatchSummary): string {
  if (m.status === "active") return "Unfinished";
  if (m.status === "draw") {
    return m.endReason === "repetition" ? "Draw (repetition)" : "Draw (stalemate)";
  }
  const winner = m.status === "w_won" ? "w" : "b";
  const onTime = m.endReason === "timeout" ? " on time" : "";
  if (m.yourColor) return (m.yourColor === winner ? "You won" : "You lost") + onTime;
  return (winner === "w" ? "White won" : "Black won") + onTime;
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
                id="tinkerchess-replay"
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
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
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

// The four legal promotion pieces, in value order (queen first — the common pick).
const PROMOTION_PIECES = ["q", "r", "b", "n"] as const;

/**
 * The promotion picker: when a pawn reaches the last rank, choose what it becomes
 * (queen / rook / bishop / knight) instead of always auto-queening. Anchored over
 * the destination square; clicking off cancels (handled by the parent).
 */
function PromotionPopover({
  left,
  top,
  color,
  onPick,
}: {
  left: number;
  top: number;
  color: "w" | "b";
  onPick: (piece: (typeof PROMOTION_PIECES)[number]) => void;
}) {
  return (
    <div
      className="promo-pop"
      style={{ left, top }}
      role="dialog"
      aria-label="Choose promotion piece"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {PROMOTION_PIECES.map((t) => (
        <button
          key={t}
          className="promo-choice"
          aria-label={`Promote to ${PIECE_NAME[t]}`}
          onClick={() => onPick(t)}
        >
          {GLYPHS[color][t]}
        </button>
      ))}
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
  // Tap-to-move (DESIGN.md default): tap a piece to select it, tap a square to
  // move there. Drag still works as a power-user shortcut. `selected` is the
  // chosen origin square index (null = nothing selected).
  const [selected, setSelected] = useState<number | null>(null);
  // A pawn move awaiting a promotion-piece choice (from→to), or null. While set,
  // the promotion picker is shown over the destination square.
  const [pendingPromo, setPendingPromo] = useState<{ from: number; to: number } | null>(null);
  const [replay, setReplay] = useState<{ id: Id<"matches">; color: "w" | "b" | null } | null>(null);
  // Rematch time-control chooser (opened from the game-over banner).
  const [showRematch, setShowRematch] = useState(false);
  const [rematchTC, setRematchTC] = useState<TimeControlId>(DEFAULT_TIME_CONTROL);
  // Client→server clock offset (serverNow − Date.now()), refreshed whenever a new
  // view arrives. The actual ticking + flag-claim live in the isolated <LiveClock>
  // / <TimeoutFlagger> components so they don't re-render the board.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  // Board sizing: the board fills its column up to a user-set max (drag handle,
  // persisted) and is clamped to whatever the column actually offers. This makes
  // it bigger than before, responsive to the window, and resizable like lichess.
  const [boardMax, setBoardMax] = useState(BOARD_DEFAULT);
  const [availWidth, setAvailWidth] = useState(BOARD_DEFAULT);
  // Touch/coarse-pointer devices (iPad, phones) have no right-click, so phasing
  // is offered as a tap instead (see onSquareClick). Detected client-side; false
  // during SSR so desktop keeps its right-click flow untouched.
  const [isTouch, setIsTouch] = useState(false);
  // Viewport width — only used to size the waiting-room board (which renders
  // before the resize-observed board column exists). Starts at the desktop
  // default so SSR/first paint is stable.
  const [viewportW, setViewportW] = useState(BOARD_DEFAULT);
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
    const s = Number(localStorage.getItem("tinkerchess:boardMax"));
    if (s) setBoardMax(Math.min(BOARD_CAP, Math.max(BOARD_MIN, s)));
  }, []);

  // Detect a coarse pointer (touch) so the UI can swap right-click affordances
  // for taps. Re-checks on change (e.g. iPad with/without a trackpad attached).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setIsTouch(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Track viewport width for the waiting-room board (see viewportW).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportW(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    localStorage.setItem("tinkerchess:boardMax", String(boardMax));
  }, [boardMax]);

  // While a phase popover is open, a click anywhere off the box cancels it.
  useEffect(() => {
    if (phaseFrom === null) return;
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".phase-pop")) setPhaseFrom(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [phaseFrom]);

  // While the promotion picker is open, a click/keypress off it cancels (the pawn
  // move is abandoned). Escape also cancels.
  useEffect(() => {
    if (pendingPromo === null) return;
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".promo-pop")) setPendingPromo(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPendingPromo(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pendingPromo]);

  const view = useQuery(
    api.games.getGameView,
    seat ? { gameId: id, seatToken: seat.seatToken ?? undefined } : "skip",
  );

  // Re-align to server time whenever a fresh view (with serverNow) arrives. This
  // updates only on data changes (infrequent), not on every clock tick.
  const serverNow = view?.serverNow;
  useEffect(() => {
    if (serverNow != null) setClockOffsetMs(serverNow - Date.now());
  }, [serverNow]);

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
    // Fit the preview board to the viewport (minus the .wrap padding) so it never
    // overflows on a phone; cap at 460 so it doesn't dominate on desktop.
    const waitBoard = Math.max(240, Math.min(460, viewportW - 40));
    return (
      <main className="wrap waiting-grid">
        <div>
          <Chessboard
            id="tinkerchess"
            position={position as BoardProps["position"]}
            boardWidth={waitBoard}
            arePiecesDraggable={false}
            customBoardStyle={{ borderRadius: "8px", opacity: 0.85 }}
            customLightSquareStyle={{ backgroundColor: "#c9d2dc" }}
            customDarkSquareStyle={{ backgroundColor: "#3e586e" }}
            customPieces={boardPieces}
          />
        </div>
        <aside style={{ display: "grid", gap: "1rem", minWidth: "min(260px, 100%)" }}>
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

  // Final board width: fill the column up to the user's chosen max, but never
  // exceed what the column actually offers — so on a narrow phone the board
  // shrinks to fit instead of overflowing (BOARD_MIN is a resize floor, not a
  // render floor). Keep a small absolute floor only as a last-resort guard.
  const fitWidth = availWidth - GUTTER - 8;
  const boardWidth = Math.max(240, Math.min(boardMax, fitWidth));

  // --- square highlights. The fog cues (your phased ghost, opponent warning) are
  // drawn by BoardOverlay below as on-board shapes (DESIGN.md). Here we only mark
  // the selected piece. Color is always paired with a shape cue (colorblind-safe).
  const styles: Record<string, CSSProperties> = {};
  // Tap-to-move selection: only valid while it's your turn and the square still
  // holds one of your pieces (guards against a stale index across turns/fog).
  const selValid =
    selected !== null && myTurn && view.board[selected]?.color === myColor;
  const selIdx = selValid ? (selected as number) : null;
  if (selIdx !== null) {
    styles[idxToSquare(selIdx)] = { boxShadow: "inset 0 0 0 5px #d9e2ec" }; // selected to move
    // Legal-move hints for the selected piece (DESIGN.md): a teal dot on an empty
    // target, a teal ring around a capturable piece. Shown ONLY while selected.
    for (const t of view.legalMoves?.[selIdx] ?? []) {
      styles[idxToSquare(t)] = view.board[t]
        ? { boxShadow: "inset 0 0 0 4px var(--legal)", borderRadius: "8px" } // capture ring
        : { background: "radial-gradient(circle, var(--legal) 16%, transparent 19%)" }; // dot
    }
  }
  if (phaseFrom !== null) {
    styles[idxToSquare(phaseFrom)] = { boxShadow: "inset 0 0 0 5px #d9e2ec" }; // phasing
  }
  // Check indicator: ring the viewer's own king while it is in check (a red border
  // shape paired with the status-line label below — never color alone, DESIGN.md).
  const myKingSq = isPlayer
    ? view.board.findIndex((p) => p?.color === myColor && p?.type === "k")
    : -1;
  // A ringed check (an enemy piece is returning onto the king's square) reads
  // differently from a standard check: it can only be answered by king flight.
  const ringedCheck = view.inCheck && myKingSq >= 0 && view.warningSquares.includes(myKingSq);
  if (view.inCheck && myKingSq >= 0) {
    styles[idxToSquare(myKingSq)] = { boxShadow: "inset 0 0 0 5px var(--danger)" };
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
  // Anchor the promotion picker (a row of 4 piece buttons) over the destination
  // square, clamped to the board and flipped above if it would overflow the bottom.
  const PROMO_W = 4 * cell + 12;
  const PROMO_H = cell + 12;
  let promoLeft = 0;
  let promoTop = 0;
  if (pendingPromo !== null) {
    const pos = squarePos(pendingPromo.to);
    promoLeft = Math.min(Math.max(0, pos.left + cell / 2 - PROMO_W / 2), Math.max(0, boardWidth - PROMO_W));
    promoTop = pos.top + cell + 6;
    if (promoTop + PROMO_H > boardWidth) promoTop = Math.max(6, pos.top - PROMO_H - 6);
  }

  // --- handlers ---
  // Fire a move at the server (authoritative under fog). `promotion` is set only
  // for a pawn reaching the last rank, chosen via the promotion picker.
  const submitMove = (from: number, to: number, promotion?: (typeof PROMOTION_PIECES)[number]) => {
    if (!seat.seatToken) return;
    makeMove({
      gameId: id,
      seatToken: seat.seatToken,
      from,
      to,
      ...(promotion ? { promotion } : {}),
      requestId: crypto.randomUUID(), // reused by Convex on retry -> idempotent
      expectedPly: view.turnsTaken.w + view.turnsTaken.b,
    }).catch((e) => setError(errText(e)));
  };

  // Submit a move from one square index to another. Shared by tap-to-move and
  // drag. A pawn reaching the back rank opens the promotion picker (queen / rook /
  // bishop / knight) instead of silently auto-queening.
  const doMove = (from: number, to: number) => {
    if (!myTurn || !seat.seatToken) return;
    const p = view.board[from];
    if (!p) return;
    const toRank = Math.floor(to / 8); // 0 = rank 1 … 7 = rank 8
    const lastRank = p.color === "w" ? toRank === 7 : toRank === 0;
    if (p.type === "p" && lastRank && (view.legalMoves?.[from]?.includes(to) ?? true)) {
      setPendingPromo({ from, to }); // pick the piece before submitting
      return;
    }
    submitMove(from, to);
  };

  // The chosen promotion piece submits the pending pawn move.
  const choosePromotion = (piece: (typeof PROMOTION_PIECES)[number]) => {
    if (!pendingPromo) return;
    submitMove(pendingPromo.from, pendingPromo.to, piece);
    setPendingPromo(null);
    setSelected(null);
  };

  const onPieceDrop: NonNullable<BoardProps["onPieceDrop"]> = (source, target) => {
    if (!myTurn || !seat.seatToken) return false;
    setSelected(null); // a drag overrides any tap-selection
    doMove(squareToIdx(source), squareToIdx(target));
    // Let the authoritative view drive the board; reject the optimistic drop.
    return false;
  };

  // Is this square one of the viewer's own phase-eligible pieces?
  const isPhaseEligible = (idx: number) => {
    if (!myTurn || !seat.seatToken) return false;
    const p = view.board[idx];
    // Phase-eligibility comes from the game's ruleset, not a hardcoded list.
    return !!p && p.color === myColor && (view.rules[p.type] ?? 0) > 0;
  };

  // Open the phase-duration popover for a square (right-click on desktop, or the
  // "Phase out" button after selecting a piece on touch).
  const openPhase = (idx: number) => {
    if (!isPhaseEligible(idx)) return;
    setSelected(null);
    setPhaseFrom(idx);
    setPhaseDuration(1);
  };

  // Tap/left-click a square — the DESIGN.md default move interaction. Tap your
  // piece to select it, tap a destination to move; tap it again to deselect, or
  // tap another of your pieces to reselect. A tap also dismisses an open popover.
  const onSquareClick: NonNullable<BoardProps["onSquareClick"]> = (square) => {
    if (phaseFrom !== null) {
      setPhaseFrom(null);
      return;
    }
    if (!myTurn || !seat.seatToken) {
      setSelected(null);
      return;
    }
    const idx = squareToIdx(square);
    if (selected === null) {
      if (view.board[idx]?.color === myColor) setSelected(idx);
      return;
    }
    if (idx === selected) {
      setSelected(null);
      return;
    }
    if (view.board[idx]?.color === myColor) {
      setSelected(idx); // switch selection to the other piece
      return;
    }
    doMove(selected, idx);
    setSelected(null);
  };

  // Right-click your own eligible piece to phase it out (desktop shortcut; touch
  // uses the visible "Phase out" button below the board).
  const onSquareRightClick: NonNullable<BoardProps["onSquareRightClick"]> = (square) => {
    if (!myTurn || !seat.seatToken) return;
    const idx = squareToIdx(square);
    if (!isPhaseEligible(idx)) {
      setPhaseFrom(null);
      return;
    }
    openPhase(idx);
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
      setError(errText(e));
    }
  };

  // Open the rematch chooser, defaulting to the time control just played. An
  // untimed game (no clock) must default to "untimed" — defaulting to a timed
  // preset would silently turn an untimed rematch into a timed one, since the
  // client always sends an explicit preset (carry-forward only runs server-side
  // when the arg is omitted).
  const openRematch = () => {
    setRematchTC((view.clock?.preset as TimeControlId | undefined) ?? "untimed");
    setShowRematch(true);
  };

  const startNewGame = async () => {
    if (!seat.seatToken) return;
    try {
      await newGame({ gameId: id, seatToken: seat.seatToken, timeControl: rematchTC });
      setShowRematch(false);
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

  // Tap-to-move selection context for the under-board action bar: the selected
  // piece (if any) and whether it can phase out (drives the "Phase out" button).
  const selectedPiece = selIdx !== null ? view.board[selIdx] : null;
  const selectedPhaseable = selIdx !== null && isPhaseEligible(selIdx);
  const tapWord = isTouch ? "Tap" : "Click";
  let actionHint: string;
  if (!myTurn) actionHint = "Waiting for your turn…";
  else if (selectedPiece)
    actionHint = selectedPhaseable
      ? `or ${tapWord.toLowerCase()} a square to move it`
      : `${tapWord} a square to move it.`;
  else
    actionHint = isTouch
      ? "Tap one of your pieces to move it."
      : "Click a piece to move it · right-click to phase it out.";

  // --- status text ---
  const colorName = (c: "w" | "b") => (c === "w" ? "White" : "Black");
  let status: string;
  if (view.status === "active") {
    if (myTurn && view.inCheck) {
      status = ringedCheck
        ? "Your king must move — a piece is returning onto it"
        : "You are in check — you must move";
    } else {
      status = myTurn
        ? "Your move"
        : isPlayer
          ? "Opponent's move"
          : `${colorName(view.turn)} to move`;
    }
  } else if (view.status === "draw") {
    status = view.endReason === "repetition" ? "Draw by repetition." : "Draw by stalemate.";
  } else {
    const winner = view.status === "w_won" ? "w" : "b";
    const youWon = isPlayer && myColor === winner;
    if (view.endReason === "timeout") {
      status = isPlayer
        ? youWon
          ? "Won on time!"
          : "Lost on time."
        : `${colorName(winner)} won on time.`;
    } else {
      status = isPlayer
        ? youWon
          ? "Checkmate — you win!"
          : "Checkmate — you lose."
        : `Checkmate — ${colorName(winner)} wins.`;
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

  // The clock (null for an untimed game). Each side renders an isolated <LiveClock>
  // that ticks on its own; <TimeoutFlagger> (mounted once below) claims the flag.
  const clock = view.clock;

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
            <button className="primary gameover-btn" onClick={openRematch}>
              New game
            </button>
          )}
        </div>
      )}

      <div className="game-grid">
        {/* BOARD COLUMN — opponent row, board, your row, then the phase queue. */}
        <section className="board-col" ref={setBoardCol}>
          <div className="board-stack" style={{ width: GUTTER + boardWidth }}>
            <div className={`player-row ${!myTurn && view.status === "active" ? "to-move" : ""}`}>
              <span className="who">
                {topLabel}
                {!myTurn && view.status === "active" && <span className="move-dot" aria-hidden> ● to move</span>}
              </span>
              <CapturedTray pieces={view.captured[bottomColor]} color={bottomColor} glyphSize={glyphSize} />
            </div>
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
                  id="tinkerchess"
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
                {pendingPromo !== null && (
                  <PromotionPopover
                    left={promoLeft}
                    top={promoTop}
                    color={myColor === "b" ? "b" : "w"}
                    onPick={choosePromotion}
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
            {isPlayer && (
              <div className="under-board">
                <PhaseQueue phased={view.yourPhased} color={myColor === "b" ? "b" : "w"} rules={view.rules} />
                {view.warningSquares.length > 0 && (
                  <div className="warn-line">⚠ An opponent piece returns next turn (dashed square on the board).</div>
                )}
              </div>
            )}
          </div>
          {isPlayer && view.status === "active" && (
            <div className="phase-action">
              {selectedPhaseable && selectedPiece && (
                <button className="primary" onClick={() => openPhase(selIdx as number)}>
                  Phase out {PIECE_NAME[selectedPiece.type]}
                </button>
              )}
              <span className="phase-hint">{actionHint}</span>
            </div>
          )}
          <span className="sr-only" aria-live="polite">{status}</span>
          {clock && view.status === "active" && clock.runningSince !== null && seat.seatToken && (
            <TimeoutFlagger
              clock={clock}
              turn={view.turn}
              offsetMs={clockOffsetMs}
              gameId={id}
              seatToken={seat.seatToken}
            />
          )}
        </section>

        {/* RIGHT PANEL (single): tools, then the clocks bracketing the move list, then chat + past games. */}
        <aside className="rail rail-right">
          <div className="rail-tools">
            <IconPopover icon="?" label="Rules" align="left">
              <strong>Phasing rules</strong>
              <div className="muted" style={{ marginTop: "0.4rem", fontSize: "0.9rem" }}>
                {phaseable.length === 0
                  ? "No pieces can phase."
                  : phaseable.map(([t, name]) => `${name} ≤${view.rules[t]}`).join(" · ")}
              </div>
              <div className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                {isTouch
                  ? "Tap one of your pieces, then choose Phase out"
                  : "Right-click a piece to phase it out"}. It returns to its square after the
                chosen number of your turns, removing whatever sits there. Win by checkmate.
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

          <div className="panel play-panel">
            {clock && (
              <LiveClock clock={clock} side={topColor} turn={view.turn} offsetMs={clockOffsetMs} />
            )}
            <div className={`namerow ${!myTurn && view.status === "active" ? "to-move" : ""}`}>
              <span className="turn-dot" aria-hidden />
              <span className="nm">{topLabel}</span>
            </div>
            <MoveLog gameId={id} seatToken={seat.seatToken ?? undefined} />
            <div className={`namerow ${myTurn ? "to-move" : ""}`}>
              <span className="turn-dot" aria-hidden />
              <span className="nm">{bottomLabel}</span>
            </div>
            {clock && (
              <LiveClock clock={clock} side={bottomColor} turn={view.turn} offsetMs={clockOffsetMs} />
            )}
          </div>

          {isPlayer && seat.seatToken && <Chat gameId={id} seatToken={seat.seatToken} />}
          <MatchHistory
            gameId={id}
            seatToken={seat.seatToken ?? undefined}
            onWatch={(matchId, color) => setReplay({ id: matchId, color })}
          />
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

      {showRematch && (
        <div className="replay-overlay" onClick={() => setShowRematch(false)}>
          <div
            className="replay-card"
            style={{ maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>New game</strong>
              <button onClick={() => setShowRematch(false)}>Cancel</button>
            </div>
            <div className="field-label">
              Time control
              <TimeControlPicker value={rematchTC} onChange={setRematchTC} />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="primary" onClick={startNewGame}>
                Start game
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
