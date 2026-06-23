// Top-level game orchestration: applying actions in turn order, and producing
// the per-viewer (fog-of-war) view.
//
// Turn lifecycle for each action:
//   1. The side to move applies a move or a phase-out (board mechanics).
//   2. If that captured the enemy king, the game ends here.
//   3. Otherwise the mover's turn counter increments and any of the MOVER's due
//      pieces phase back in — at the END of their turn (which may itself end the
//      game by removing a king).
//   4. The turn flips to the opponent.
//
// Phase-in resolves at the END of the owner's turn (not the start) so the owner
// gets to play the turn with the piece still out and exploit the open space.
// A piece phased for duration d is therefore absent across d of the owner's own
// turns and reappears at the end of the d-th one. (Resolving at the start would
// make a duration of 1 pointless — the piece would return before the owner moved.)

import { cloneState, initialState, pieceAt } from "./board.js";
import { applyMove, deriveMoveEvent, generateMoves, isLegalMove } from "./moves.js";
import {
  ownPhased,
  resolvePhaseInsWithEvents,
  applyPhaseOut,
  derivePhaseOutEvent,
  warningSquaresFor,
} from "./phase.js";
import type {
  Action,
  Color,
  GameEvent,
  GameState,
  GameStatus,
  Move,
  Piece,
  RuleConfig,
  SelfCaptureEvent,
  SquareIndex,
} from "./types.js";

/** Start a fresh game, optionally with a custom ruleset (Tier-1 Settings). */
export function createGame(config?: RuleConfig): GameState {
  return initialState(config);
}

export class IllegalActionError extends Error {}

/**
 * Apply an action for the side to move, returning the new state AND the derived
 * events (move/phaseOut, then any end-of-turn phaseIns). Throws
 * IllegalActionError if the action is not legal or the game is already over.
 * This is the single source of truth; `applyAction` returns only the state.
 */
export function applyActionWithEvents(
  state: GameState,
  action: Action,
): { state: GameState; events: GameEvent[] } {
  if (state.status !== "active") {
    throw new IllegalActionError("game is over");
  }

  const mover = state.turn;
  const events: GameEvent[] = [];
  let next: GameState;

  if (action.kind === "move") {
    if (!ownsPiece(state, action.move.from, mover)) {
      throw new IllegalActionError("not your piece");
    }
    if (!isLegalMove(state, action.move)) {
      throw new IllegalActionError("illegal move");
    }
    next = applyMove(state, action.move);
    events.push(deriveMoveEvent(state, action.move, next));
  } else {
    next = applyPhaseOut(state, action.phaseOut); // validates internally, throws if illegal
    events.push(derivePhaseOutEvent(state, action.phaseOut)); // derive from untouched pre-state
  }

  // The self-capture notice reflects only the action just applied.
  next.lastEvent = null;

  // The action itself may have ended the game (king captured).
  next.turnsTaken[mover] += 1;
  if (next.status !== "active") return { state: next, events };

  // End-of-turn phase-ins for the mover (may end the game by removing a king).
  const resolved = resolvePhaseInsWithEvents(next, mover);
  next = resolved.state;
  events.push(...resolved.events);
  if (next.status !== "active") return { state: next, events };

  next.turn = mover === "w" ? "b" : "w";
  return { state: next, events };
}

/**
 * Apply an action for the side to move, returning the new state. Throws
 * IllegalActionError if the action is not legal or the game is already over.
 */
export function applyAction(state: GameState, action: Action): GameState {
  return applyActionWithEvents(state, action).state;
}

function ownsPiece(state: GameState, sq: SquareIndex, color: Color): boolean {
  const p = pieceAt(state.board, sq);
  return p !== null && p.color === color;
}

/**
 * Replay an action sequence from a starting state (default: a fresh game),
 * returning the final state. The engine is a pure, deterministic reducer with no
 * randomness, so `replay(actions)` always reproduces the same state — this is the
 * foundation for game history, per-seat logs, and the post-game reveal: a finished
 * game is stored as `{ initialState, actions }` and re-derived on demand rather
 * than as board snapshots. Throws IllegalActionError if any action is illegal.
 */
export function replay(actions: Action[], from: GameState = createGame()): GameState {
  let state = from;
  for (const action of actions) state = applyAction(state, action);
  return state;
}

/** All legal moves for the side to move (for UI highlighting / tests). */
export function legalMoves(state: GameState): Move[] {
  if (state.status !== "active") return [];
  const moves: Move[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (p && p.color === state.turn) moves.push(...generateMoves(state, sq));
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Fog-of-war view
// ---------------------------------------------------------------------------

export type Viewer = Color | "spectator";

export interface ViewPhasedPiece {
  type: Piece["type"];
  origin: SquareIndex;
  returnOn: number;
  turnsRemaining: number;
}

export interface GameView {
  /** In-play pieces only — phased pieces are absent for everyone. */
  board: (Piece | null)[];
  turn: Color;
  status: GameStatus;
  /** When the game is over, whether the loser captured their own king. */
  wonBySelfCapture: boolean;
  /** Most recent non-terminal self-capture (visible to all), or null. */
  lastEvent: SelfCaptureEvent | null;
  /** Permanently captured pieces per color (the captured piece's color). */
  captured: { w: Piece["type"][]; b: Piece["type"][] };
  turnsTaken: { w: number; b: number };
  /** The viewer's seat, or "spectator". */
  you: Viewer;
  /** The viewer's OWN phased pieces with timers. Empty for spectators. */
  yourPhased: ViewPhasedPiece[];
  /**
   * Squares to highlight as a one-turn warning: the opponent's pieces returning
   * next turn (square only). Empty for spectators. NEVER includes the opponent's
   * timers or piece identities.
   */
  warningSquares: SquareIndex[];
}

/**
 * Build the filtered view for a given viewer. This is the privacy boundary:
 * it must never leak an opponent's phased pieces, timers, or return squares
 * beyond the allowed square-only warning. `state.phased` is never serialized.
 */
export function viewFor(state: GameState, viewer: Viewer): GameView {
  const isPlayer = viewer === "w" || viewer === "b";
  return {
    board: state.board.slice(),
    turn: state.turn,
    status: state.status,
    wonBySelfCapture: state.wonBySelfCapture,
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
    turnsTaken: { ...state.turnsTaken },
    you: viewer,
    yourPhased: isPlayer
      ? ownPhased(state, viewer).map((p) => ({
          type: p.type,
          origin: p.origin,
          returnOn: p.returnOn,
          turnsRemaining: p.turnsRemaining,
        }))
      : [],
    warningSquares: isPlayer ? warningSquaresFor(state, viewer) : [],
  };
}

// ---------------------------------------------------------------------------
// Post-game reveal view (replay only)
// ---------------------------------------------------------------------------

export interface RevealPhasedPiece {
  color: Color;
  type: Piece["type"];
  origin: SquareIndex;
  returnOn: number;
}

/**
 * A fully-revealed view for replaying a FINISHED game: exposes BOTH sides' phased
 * pieces (origin, type, timer). There is no secrecy once a game is over, so unlike
 * viewFor this hides nothing. Never use this for a live game — it would leak the
 * fog. Replay's "watch from a seat" perspectives use viewFor instead.
 */
export interface RevealView {
  board: (Piece | null)[];
  turn: Color;
  status: GameStatus;
  wonBySelfCapture: boolean;
  lastEvent: SelfCaptureEvent | null;
  captured: { w: Piece["type"][]; b: Piece["type"][] };
  turnsTaken: { w: number; b: number };
  /** Every phased piece, both colors, fully revealed. */
  phased: RevealPhasedPiece[];
}

export function revealView(state: GameState): RevealView {
  return {
    board: state.board.slice(),
    turn: state.turn,
    status: state.status,
    wonBySelfCapture: state.wonBySelfCapture,
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
    turnsTaken: { ...state.turnsTaken },
    phased: state.phased.map((p) => ({
      color: p.color,
      type: p.type,
      origin: p.origin,
      returnOn: p.returnOn,
    })),
  };
}

export { cloneState };
