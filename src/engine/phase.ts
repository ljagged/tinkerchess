// Phasing: the hidden-information heart of the variant.
//
//   - phaseOut removes a phase-eligible piece from the board for `duration` of
//     the owner's own turns. Eligibility and the duration cap come from the
//     game's RuleConfig (see types.ts), defaulting to DEFAULT_RULE_CONFIG.
//   - resolvePhaseIns runs at the END of a color's turn (after the turn counter
//     increments): any of that color's pieces whose timer has expired reappear on
//     their origin square, removing whatever occupies it — REGARDLESS OF COLOR,
//     including a king (own king => you lose; enemy king => you win). Resolving at
//     the END (not the start) lets the owner play the turn with the piece still
//     out (see game.ts).
//
// Neither function flips the turn; game.ts orchestrates turn order.

import { cloneState, pieceAt } from "./board.js";
import { isAttacked } from "./attacks.js";
import { DEFAULT_RULE_CONFIG } from "./types.js";
import type {
  Color,
  GameState,
  PhaseOut,
  PhasedPiece,
  PieceType,
  RuleConfig,
  SquareIndex,
} from "./types.js";

/** Whether a piece type may phase under a ruleset (derived from its duration cap). */
export function isPhaseable(type: PieceType, config: RuleConfig = DEFAULT_RULE_CONFIG): boolean {
  return config.maxPhaseDuration[type] > 0;
}

/** Max phase-out duration for a piece type under a ruleset (0 = cannot phase). */
export function maxDuration(type: PieceType, config: RuleConfig = DEFAULT_RULE_CONFIG): number {
  return config.maxPhaseDuration[type];
}

export interface PhaseOutCheck {
  ok: boolean;
  reason?: string;
}

/** Validate a phase-out for the side to move without mutating state. */
export function validatePhaseOut(state: GameState, action: PhaseOut): PhaseOutCheck {
  if (state.status !== "active") return { ok: false, reason: "game is over" };
  const config = state.config ?? DEFAULT_RULE_CONFIG;
  const piece = pieceAt(state.board, action.from);
  if (!piece) return { ok: false, reason: "no piece on that square" };
  if (piece.color !== state.turn) return { ok: false, reason: "not your piece" };
  if (!isPhaseable(piece.type, config)) {
    return { ok: false, reason: "this piece type cannot phase under the current rules" };
  }

  const max = maxDuration(piece.type, config);
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
  // This is the owner's (turnsTaken+1)-th turn; the piece reappears at the END
  // of their turn `duration` later, i.e. after they complete that many turns.
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
 * Resolve any phase-ins due for `color` at the END of their turn — i.e. after
 * the turn counter has been incremented, so `returnOn === turnsTaken[color]`
 * means "due now". Resolving at the end (not the start) of the turn lets the
 * owner play the turn with the piece out before it returns. Mutates a cloned
 * copy and returns it. If a king is removed by a phase-in, the game ends.
 */
export function resolvePhaseIns(state: GameState, color: Color): GameState {
  const completed = state.turnsTaken[color];
  const anyDue = state.phased.some((p) => p.color === color && p.returnOn <= completed);
  if (!anyDue) return state;

  const next = cloneState(state);
  // Filter from the CLONE so the references match next.phased for removal.
  const due = next.phased.filter((p) => p.color === color && p.returnOn <= completed);
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
    if (occupant) next.captured[occupant.color].push(occupant.type);
    if (occupant && occupant.type === "k") {
      // The reappearing piece removed a king. Owner of the removed king loses;
      // it's a footgun if the reappearing piece belonged to that same side.
      next.status = occupant.color === "w" ? "b_won" : "w_won";
      next.wonBySelfCapture = occupant.color === piece.color;
    } else if (occupant && occupant.color === piece.color) {
      // Removed one of the owner's own (non-king) pieces — a footgun to surface.
      next.lastEvent = { by: piece.color, piece: occupant.type, square: piece.origin };
    }
  }
  return next;
}

function removePhased(phased: PhasedPiece[], target: PhasedPiece): void {
  const idx = phased.indexOf(target);
  if (idx >= 0) phased.splice(idx, 1);
}

/**
 * The viewer's own phased pieces, with how many of the viewer's own turns
 * remain until each returns (it reappears at the end of that turn). A piece due
 * at the end of the viewer's next turn shows 1.
 */
export function ownPhased(
  state: GameState,
  viewer: Color,
): Array<PhasedPiece & { turnsRemaining: number }> {
  return state.phased
    .filter((p) => p.color === viewer)
    .map((p) => ({ ...p, turnsRemaining: p.returnOn - state.turnsTaken[viewer] }));
}

/**
 * Squares the viewer should see highlighted as a one-turn warning: origin
 * squares of the OPPONENT's pieces that will phase back in at the end of the
 * opponent's next turn. Reveals the square only — never the piece identity.
 */
export function warningSquaresFor(state: GameState, viewer: Color): SquareIndex[] {
  return state.phased
    .filter((p) => p.color !== viewer && p.returnOn === state.turnsTaken[p.color] + 1)
    .map((p) => p.origin);
}
