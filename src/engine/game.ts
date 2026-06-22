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
import { applyMove, generateMoves, isLegalMove } from "./moves.js";
import { ownPhased, resolvePhaseIns, applyPhaseOut, warningSquaresFor } from "./phase.js";
import type {
  Action,
  Color,
  GameState,
  GameStatus,
  Move,
  Piece,
  SelfCaptureEvent,
  SquareIndex,
} from "./types.js";

export function createGame(): GameState {
  return initialState();
}

export class IllegalActionError extends Error {}

/**
 * Apply an action for the side to move, returning the new state. Throws
 * IllegalActionError if the action is not legal or the game is already over.
 */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.status !== "active") {
    throw new IllegalActionError("game is over");
  }

  const mover = state.turn;
  let next: GameState;

  if (action.kind === "move") {
    if (!ownsPiece(state, action.move.from, mover)) {
      throw new IllegalActionError("not your piece");
    }
    if (!isLegalMove(state, action.move)) {
      throw new IllegalActionError("illegal move");
    }
    next = applyMove(state, action.move);
  } else {
    next = applyPhaseOut(state, action.phaseOut); // validates internally
  }

  // The self-capture notice reflects only the action just applied.
  next.lastEvent = null;

  // The action itself may have ended the game (king captured).
  next.turnsTaken[mover] += 1;
  if (next.status !== "active") return next;

  // End-of-turn phase-ins for the mover (may end the game by removing a king).
  next = resolvePhaseIns(next, mover);
  if (next.status !== "active") return next;

  next.turn = mover === "w" ? "b" : "w";
  return next;
}

function ownsPiece(state: GameState, sq: SquareIndex, color: Color): boolean {
  const p = pieceAt(state.board, sq);
  return p !== null && p.color === color;
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

export { cloneState };
