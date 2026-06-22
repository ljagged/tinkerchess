// Phasing: the hidden-information heart of the variant.
//
//   - phaseOut removes a non-pawn piece from the board for `duration` of the
//     owner's own turns. Duration is bounded per piece type and locked in.
//   - resolvePhaseIns runs at the START of a color's turn: any of that color's
//     pieces whose timer has expired reappear on their origin square, removing
//     whatever occupies it — REGARDLESS OF COLOR, including a king (own king =>
//     you lose; enemy king => you win).
//
// Neither function flips the turn; game.ts orchestrates turn order.

import { cloneState, pieceAt } from "./board.js";
import { isAttacked } from "./attacks.js";
import { MAX_PHASE_DURATION } from "./types.js";
import type {
  Color,
  GameState,
  PhaseOut,
  PhasedPiece,
  PieceType,
  SquareIndex,
} from "./types.js";

export function isPhaseable(type: PieceType): boolean {
  return type !== "p";
}

export function maxDuration(type: PieceType): number {
  if (type === "p") return 0;
  return MAX_PHASE_DURATION[type];
}

export interface PhaseOutCheck {
  ok: boolean;
  reason?: string;
}

/** Validate a phase-out for the side to move without mutating state. */
export function validatePhaseOut(state: GameState, action: PhaseOut): PhaseOutCheck {
  if (state.status !== "active") return { ok: false, reason: "game is over" };
  const piece = pieceAt(state.board, action.from);
  if (!piece) return { ok: false, reason: "no piece on that square" };
  if (piece.color !== state.turn) return { ok: false, reason: "not your piece" };
  if (!isPhaseable(piece.type)) return { ok: false, reason: "pawns cannot phase" };

  const max = maxDuration(piece.type);
  if (!Number.isInteger(action.duration) || action.duration < 1 || action.duration > max) {
    return { ok: false, reason: `duration must be 1..${max} for this piece` };
  }

  // The king may not phase out of check.
  if (piece.type === "k" && isAttacked(state, action.from, state.turn === "w" ? "b" : "w")) {
    return { ok: false, reason: "king cannot phase out while in check" };
  }

  return { ok: true };
}

/**
 * Apply a phase-out's mechanics, returning a new state. Removes the piece from
 * the board and records its return timer. Does NOT flip the turn.
 * Precondition: validatePhaseOut(state, action).ok — throws otherwise.
 */
export function applyPhaseOut(state: GameState, action: PhaseOut): GameState {
  const check = validatePhaseOut(state, action);
  if (!check.ok) throw new Error(`illegal phase-out: ${check.reason}`);

  const next = cloneState(state);
  const piece = pieceAt(next.board, action.from)!;
  const owner = piece.color;
  // Current turn ordinal for the owner is turnsTaken+1; it returns `duration`
  // of the owner's turns later.
  const returnOn = next.turnsTaken[owner] + 1 + action.duration;

  next.board[action.from] = null;
  next.phased.push({
    color: owner,
    type: piece.type,
    origin: action.from,
    returnOn,
  });
  return next;
}

/**
 * Resolve any phase-ins due for `color` at the start of their turn. Mutates a
 * cloned copy and returns it. If a king is removed by a phase-in, the game ends
 * immediately.
 */
export function resolvePhaseIns(state: GameState, color: Color): GameState {
  const ordinal = state.turnsTaken[color] + 1;
  const anyDue = state.phased.some((p) => p.color === color && p.returnOn <= ordinal);
  if (!anyDue) return state;

  const next = cloneState(state);
  // Filter from the CLONE so the references match next.phased for removal.
  const due = next.phased.filter((p) => p.color === color && p.returnOn <= ordinal);
  // Deterministic order: earliest timer first, then insertion order.
  due.sort((a, b) => a.returnOn - b.returnOn);

  for (const piece of due) {
    removePhased(next.phased, piece);
    if (next.status !== "active") {
      // Game already ended this resolution; still place the piece, but stop
      // evaluating further captures.
      next.board[piece.origin] = { color: piece.color, type: piece.type };
      continue;
    }
    const occupant = pieceAt(next.board, piece.origin);
    next.board[piece.origin] = { color: piece.color, type: piece.type };
    if (occupant && occupant.type === "k") {
      // The reappearing piece removed a king. Owner of the removed king loses.
      next.status = occupant.color === "w" ? "b_won" : "w_won";
    }
  }
  return next;
}

function removePhased(phased: PhasedPiece[], target: PhasedPiece): void {
  const idx = phased.indexOf(target);
  if (idx >= 0) phased.splice(idx, 1);
}

/** The viewer's own phased pieces, with turns remaining until each returns. */
export function ownPhased(
  state: GameState,
  viewer: Color,
): Array<PhasedPiece & { turnsRemaining: number }> {
  return state.phased
    .filter((p) => p.color === viewer)
    .map((p) => ({ ...p, turnsRemaining: p.returnOn - (state.turnsTaken[viewer] + 1) }));
}

/**
 * Squares the viewer should see highlighted as a one-turn warning: origin
 * squares of the OPPONENT's pieces that will phase back in on the opponent's
 * very next turn. Reveals the square only — never the piece identity.
 */
export function warningSquaresFor(state: GameState, viewer: Color): SquareIndex[] {
  return state.phased
    .filter((p) => p.color !== viewer && p.returnOn === state.turnsTaken[p.color] + 1)
    .map((p) => p.origin);
}
