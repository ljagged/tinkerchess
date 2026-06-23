// Move-log notation: render a derived GameEvent as a human-readable string.
//
// Pure and display-only — the engine replays from the action/event log, never from
// notation, so this never needs to round-trip. Two flavors via NotationOptions:
//   - letters (default): SAN-style — "Nf3", "exd5", "O-O", "a8=Q"
//   - figurine: Unicode piece glyphs — "♘f3", "♗f1~3"
//
// Phase Chess extensions to SAN:
//   - phase-out:  <piece><from>~<duration>     e.g. "Bf1~3"  (bishop on f1 phases 3)
//   - phase-in:   <piece>@<square>[x<piece>]   e.g. "R@a1"  /  "R@a1xN"
//   - king capture (the win condition, no checkmate): trailing "#"
//   - check: trailing "+"
//   - self-capture (a footgun): trailing "(self)"
//
// NOTE: piece-move disambiguation (e.g. "Nbd2") needs full board context, which a
// single event lacks. Notation is paired with the visual board (each log entry
// carries from/to for highlighting), so minimal SAN is sufficient for M1; richer
// disambiguation can take board context later if ever needed.

import { FILES, fileOf, toAlgebraic } from "./board.js";
import type { Color, GameEvent, PieceType } from "./types.js";

const LETTER: Record<PieceType, string> = { p: "", n: "N", b: "B", r: "R", q: "Q", k: "K" };
const GLYPH: Record<Color, Record<PieceType, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

export interface NotationOptions {
  /** Render Unicode chess glyphs instead of letters. */
  figurine?: boolean;
}

/** The moving piece's symbol (empty for a pawn in letter mode). */
function pieceSym(type: PieceType, color: Color, figurine: boolean): string {
  return figurine ? GLYPH[color][type] : LETTER[type];
}

/** A captured piece's symbol; in letter mode pawns show "P" (capture context). */
function capturedSym(type: PieceType, color: Color, figurine: boolean): string {
  return figurine ? GLYPH[color][type] : type.toUpperCase();
}

/** Render a single derived event as a move-log string. */
export function toNotation(event: GameEvent, opts: NotationOptions = {}): string {
  const fig = !!opts.figurine;

  if (event.kind === "phaseOut") {
    return `${pieceSym(event.piece, event.color, fig)}${toAlgebraic(event.from)}~${event.duration}`;
  }

  if (event.kind === "phaseIn") {
    let s = `${pieceSym(event.piece, event.color, fig)}@${toAlgebraic(event.to)}`;
    if (event.capture) s += `x${capturedSym(event.capture.type, event.capture.color, fig)}`;
    if (event.kingCapture) s += "#";
    const selfKing = !!event.kingCapture && event.capture?.color === event.color;
    if (event.selfCapture || selfKing) s += "(self)";
    return s;
  }

  // move
  let s: string;
  if (event.castle) {
    s = event.castle === "K" ? "O-O" : "O-O-O";
  } else if (event.piece === "p") {
    const dest = toAlgebraic(event.to);
    s = event.capture ? `${FILES[fileOf(event.from)]}x${dest}` : dest;
    if (event.promotion) s += `=${pieceSym(event.promotion, event.color, fig)}`;
  } else {
    s = `${pieceSym(event.piece, event.color, fig)}${event.capture ? "x" : ""}${toAlgebraic(event.to)}`;
  }
  if (event.kingCapture) s += "#";
  else if (event.check) s += "+";
  return s;
}

/**
 * Render an event as the VIEWER sees it in their live move log. Identical to
 * toNotation EXCEPT it redacts the duration of the OPPONENT's phase-out — the one
 * secret a move log could leak. The opponent sees a piece vanish from a visible
 * square (so the piece and origin are known) but never learns how long it will be
 * gone, only a one-turn square warning before it returns. Everything else (moves,
 * captures, phase-ins, and all of the viewer's own actions) is public.
 *
 * The post-game TRUE log uses toNotation (no redaction) to reveal everything.
 */
export function toSeatNotation(
  event: GameEvent,
  viewer: Color | "spectator",
  opts: NotationOptions = {},
): string {
  // A player sees only the OPPONENT's phase-out duration hidden; a spectator sees
  // BOTH sides' durations hidden (event.color never equals "spectator").
  if (event.kind === "phaseOut" && event.color !== viewer) {
    return `${pieceSym(event.piece, event.color, !!opts.figurine)}${toAlgebraic(event.from)}~?`;
  }
  return toNotation(event, opts);
}
