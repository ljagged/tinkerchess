// Phasing: the hidden-information heart of the variant.
//
//   - phaseOut removes a phase-eligible piece from the board for `duration` of
//     the owner's own turns. Eligibility and the duration cap come from the
//     game's RuleConfig (see types.ts), defaulting to DEFAULT_RULE_CONFIG.
//   - resolvePhaseIns runs at the END of a color's turn (after the turn counter
//     increments): any of that color's pieces whose timer has expired reappear on
//     their origin square, destroying whatever occupies it — with two king rules
//     (S5): a return onto your OWN king self-destructs the returning piece (the
//     king is unaffected), and a return onto an ENEMY king is unreachable (S5a
//     forces the king off first). NO king is ever removed by a phase-in (S9).
//     Resolving at the END (not the start) lets the owner play the turn with the
//     piece still out (see game.ts).
//
// Neither function flips the turn nor ends the game; game.ts orchestrates turn
// order and adjudicates checkmate / stalemate / repetition.

import { cloneState, pieceAt } from "./board.js";
import { isAttacked, findKing } from "./attacks.js";
import { DEFAULT_RULE_CONFIG } from "./types.js";
import type {
  Color,
  GameEvent,
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

/**
 * The unified king-safety predicate. A king is SAFE iff it is neither attacked by
 * an enemy in-play piece (standard check) NOR sitting on a square that shows the
 * ENEMY's imminent-return warning ring (a S5a ringed-king check). This one
 * predicate yields standard check, the ringed-king check (flight-only falls out,
 * because any non-king move leaves the king on the unsafe square), and ring
 * ownership (only the enemy's ring counts — your own return is not an attack).
 *
 * A king that is currently phased out (off the board) has nothing to attack, so
 * it is trivially "safe" — there is no in-play king to be in check.
 *
 * The returning piece is NEVER injected into attack generation; the ring is a
 * narrow per-square check that reuses the same fog data the UI shows
 * (`warningSquaresFor`), so it is correctly time-aligned (visible one turn ahead).
 */
export function kingSafe(state: GameState, color: Color): boolean {
  const k = findKing(state, color);
  if (k === null) return true;
  const enemy: Color = color === "w" ? "b" : "w";
  if (isAttacked(state, k, enemy)) return false;
  return !warningSquaresFor(state, color).includes(k);
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

  // The king may not phase out while in check (standard attack OR an enemy ring).
  if (piece.type === "k" && !kingSafe(state, piece.color)) {
    return { ok: false, reason: "king cannot phase out while in check" };
  }

  // S7: a phase-out is illegal if, after the piece is removed, the mover's own
  // king would be in check (e.g. phasing a pinned piece or one blocking an attack
  // on the king). Reuse the king-safety predicate on the post-removal board.
  // (A phase-IN can never expose the king — S4b — so there is no analogous rule.)
  const afterRemoval = cloneState(state);
  afterRemoval.board[action.from] = null;
  if (!kingSafe(afterRemoval, piece.color)) {
    return { ok: false, reason: "phasing that piece would leave your king in check" };
  }

  return { ok: true };
}

/**
 * All legal phase-out actions for the side to move: every (eligible piece ×
 * duration 1..maxDuration) that passes validatePhaseOut. Built ON TOP of the
 * existing validator — it adds no new legality logic. Returns [] if the game is
 * over (and, because every phase-out fails the king-safety gate while in check,
 * [] whenever the side to move is in check — RULES.md §8.3).
 *
 * Like legalMovesFrom this is a rules QUERY, not an adjudication input: phase-outs
 * still never count toward "has a legal move" for mate/stalemate (adjudicate in
 * game.ts uses legalMoves only). A consumer that needs the full action space —
 * e.g. the bot — concatenates this with legalMoves.
 */
export function legalPhaseOuts(state: GameState): PhaseOut[] {
  if (state.status !== "active") return [];
  const config = state.config ?? DEFAULT_RULE_CONFIG;
  const out: PhaseOut[] = [];
  for (let from = 0; from < 64; from++) {
    const piece = pieceAt(state.board, from);
    if (!piece || piece.color !== state.turn || !isPhaseable(piece.type, config)) continue;
    const max = maxDuration(piece.type, config);
    for (let d = 1; d <= max; d++) {
      if (validatePhaseOut(state, { from, duration: d }).ok) out.push({ from, duration: d });
    }
  }
  return out;
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

/** Derive the phase-out event from the pre-state and the action. Pure. */
export function derivePhaseOutEvent(pre: GameState, action: PhaseOut): GameEvent {
  const piece = pieceAt(pre.board, action.from);
  if (!piece) throw new Error(`no piece on square ${action.from}`);
  return {
    kind: "phaseOut",
    color: piece.color,
    piece: piece.type,
    from: action.from,
    duration: action.duration,
    returnOn: pre.turnsTaken[piece.color] + 1 + action.duration,
  };
}

/**
 * Resolve due phase-ins for `color` at the END of their turn — i.e. after the
 * turn counter has been incremented, so `returnOn === turnsTaken[color]` means
 * "due now". Returns the new state and the phaseIn events. Resolution per the
 * S5 table, by what occupies the origin square:
 *   - empty         -> the piece returns, nothing destroyed.
 *   - enemy non-king -> enemy captured; returning piece takes the square.
 *   - enemy KING    -> UNREACHABLE (S9): S5a forces the enemy king off the square
 *                      or mates it the prior turn. Throwing here is a safety
 *                      assertion that the ring-as-check is wired correctly.
 *   - own non-king  -> own piece destroyed; returning piece takes the square (footgun).
 *   - own KING      -> the RETURNING PIECE self-destructs; the king is unaffected
 *                      (kings are immune to friendly fire). No capture, no loss.
 * NO king is ever removed from the board by a phase-in (S9). The game never ends
 * here; mate/stalemate/repetition are adjudicated afterward in game.ts.
 * `resolvePhaseIns` wraps this for callers that only need the state.
 */
export function resolvePhaseInsWithEvents(
  state: GameState,
  color: Color,
): { state: GameState; events: GameEvent[] } {
  const completed = state.turnsTaken[color];
  const anyDue = state.phased.some((p) => p.color === color && p.returnOn <= completed);
  if (!anyDue) return { state, events: [] };

  const next = cloneState(state);
  // Filter from the CLONE so the references match next.phased for removal.
  const due = next.phased.filter((p) => p.color === color && p.returnOn <= completed);
  // Deterministic order: earliest timer first, then insertion order.
  due.sort((a, b) => a.returnOn - b.returnOn);

  const events: GameEvent[] = [];
  for (const piece of due) {
    removePhased(next.phased, piece);
    const occupant = pieceAt(next.board, piece.origin);

    // Own king on the origin: the returning piece self-destructs; the king stays.
    if (occupant && occupant.type === "k" && occupant.color === piece.color) {
      events.push({
        kind: "phaseIn",
        color: piece.color,
        piece: piece.type,
        to: piece.origin,
        selfDestruct: true,
      });
      continue;
    }

    // Enemy king on the origin: must be unreachable (S5a/S9). If this fires, the
    // ringed-king check is in the wrong place.
    if (occupant && occupant.type === "k") {
      throw new Error("invariant violation: phase-in resolved onto a live enemy king (S9)");
    }

    // Otherwise the returning piece takes the square, destroying any occupant.
    next.board[piece.origin] = { color: piece.color, type: piece.type };
    const selfCapture = !!occupant && occupant.color === piece.color; // own non-king (king handled above)
    if (occupant) {
      next.captured[occupant.color].push(occupant.type);
      if (selfCapture) {
        // Removed one of the owner's own (non-king) pieces — a footgun to surface.
        next.lastEvent = { by: piece.color, piece: occupant.type, square: piece.origin };
      }
    }
    events.push({
      kind: "phaseIn",
      color: piece.color,
      piece: piece.type,
      to: piece.origin,
      ...(occupant ? { capture: { color: occupant.color, type: occupant.type } } : {}),
      ...(selfCapture ? { selfCapture: true as const } : {}),
    });
  }
  return { state: next, events };
}

export function resolvePhaseIns(state: GameState, color: Color): GameState {
  return resolvePhaseInsWithEvents(state, color).state;
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
