// The mechanic registry — the kernel's extension seam for per-turn mechanics.
//
// A Mechanic folds over the always-on classical kernel (board · move-gen ·
// check/mate · castling · promotion). Phasing is plugin #1; boost (Stage 3) and
// promotion-grants-boost (Stage 4) register the same way — "write a module + register
// it", never edit the core. The interface is centered on the load-bearing seam
// (decision 1): a mechanic that changes how a piece moves contributes ONE function
// (`pieceMovesAndAttacks`) that BOTH move-gen and `isAttacked` fold over, so they can
// never desync (a move-only augmentation would let a king move into check / miss a
// mate). That fold is GATED on an augmenting mechanic actually being active — when
// none is (classical / phasing-only), `augmentsActive` short-circuits on an empty set,
// so the hot path pays a single length check and nothing more (perf finding 7).
//
// Layering: this module is engine-only (imports types + notation types). Eval is a
// bot-layer concern (weights live in the bot), so a mechanic's eval contribution is
// registered separately in the bot (see src/bot/mechanicEval.ts); everything here is
// pure over GameState.

import type {
  Action,
  Color,
  GameEvent,
  GameState,
  Move,
  Piece,
  PieceType,
  SquareIndex,
} from "./types.js";
import type { NotationOptions } from "./notation.js";

/**
 * One pluggable per-turn mechanic. Every hook is optional: a mechanic implements
 * only the seams it touches. Phasing, for example, adds actions, ticks at end of
 * turn, hashes its hidden state, and renders its own events — but does NOT augment
 * how pieces move, so it leaves `pieceMovesAndAttacks` undefined and the kernel's
 * attack fold stays dormant.
 */
export interface Mechanic {
  readonly id: string;

  /** Extra legal actions for the side to move (e.g. phase-outs). Unioned AFTER moves. */
  legalActions?(state: GameState): Action[];

  /** Does this mechanic own `action`? Non-"move" actions route to their owner's applyAction. */
  ownsAction?(action: Action): boolean;

  /**
   * Apply an owned action's board mechanics and derive its initiating event(s).
   * Must NOT flip the turn or tick timers — game.ts orchestrates that. Precondition:
   * the action is legal (the mechanic validates, throwing on an illegal action).
   */
  applyAction?(state: GameState, action: Action): { state: GameState; events: GameEvent[] };

  /**
   * React to a "move" action's board mutation, mutating `state` in place (it is a
   * fresh post-move clone). Lets a mechanic carry per-piece state with the piece —
   * boost relocates a moved piece's buff from→to and drops a captured one. NOT called
   * for the mechanic's OWN actions (those handle their own bookkeeping).
   */
  afterMove?(state: GameState, move: Move): void;

  /**
   * INTERCEPT promotion (decision: mechanics intercept core rules, not just add
   * actions). Called in applyMove the moment a pawn promotes, with the chosen piece
   * type already placed on `square`; the mechanic may augment the outcome (e.g.
   * promotion-grants-boost upgrades the new piece to its fairy form). Mutates state in
   * place. Gated on a promotion actually happening, so non-promotion play pays nothing.
   */
  onPromotion?(state: GameState, square: SquareIndex, promoted: PieceType): void;

  /**
   * End-of-turn tick for `mover` (phase-ins, buff expiry), after the turn counter
   * increments and before the turn flips. Returns the new state and any events.
   */
  onTurnEnd?(state: GameState, mover: Color): { state: GameState; events: GameEvent[] };

  /**
   * THE load-bearing seam (decision 1). The augmented moves AND attack squares for
   * `piece` on `from`, or null if this mechanic does not alter that piece. Move-gen
   * folds in `.moves`; `isAttacked` folds in `.attacks` — one source, never two.
   */
  pieceMovesAndAttacks?(
    state: GameState,
    from: SquareIndex,
    piece: Piece,
  ): { moves: Move[]; attacks: SquareIndex[] } | null;

  /**
   * Transposition-key fragment for the bot's TT. MANDATORY for any mechanic with
   * hidden or move-affecting state, or the table corrupts (two search-distinct
   * positions collide). Pure; returns "" if the mechanic adds no search-relevant state.
   */
  stateHash?(state: GameState): string;

  /** Render an event this mechanic produced, or null to let the kernel render it. */
  renderEvent?(event: GameEvent, opts: NotationOptions): string | null;
}

// --- registry ---------------------------------------------------------------

const REGISTRY = new Map<string, Mechanic>();
// Ids of registered mechanics that augment piece movement (decision-1 fold gate).
// Kept as a set so `augmentsActive` is a single .size check when none exist.
const AUGMENTING_IDS = new Set<string>();

/** Register a built-in mechanic. Idempotent by id (last registration wins). */
export function registerMechanic(mechanic: Mechanic): void {
  REGISTRY.set(mechanic.id, mechanic);
  if (mechanic.pieceMovesAndAttacks) AUGMENTING_IDS.add(mechanic.id);
}

export function getMechanic(id: string): Mechanic | undefined {
  return REGISTRY.get(id);
}

/** All registered mechanics, registration order. Used by event rendering, which
 *  has only the event (no state) and so tries every mechanic's renderEvent. */
export function allMechanics(): Mechanic[] {
  return [...REGISTRY.values()];
}

/**
 * The ids of the mechanics active for `state`, in pinned (fold) order. Reads the
 * named `mechanics` field when present; legacy states (no field) resolve to phasing
 * only — preserving today's behavior exactly (the Stage-1 back-compat adapter).
 */
export function activeMechanicIds(state: GameState): string[] {
  return state.mechanics ?? ["phasing"];
}

/** The active Mechanic objects for `state`, in pinned order (unknown ids dropped). */
export function activeMechanics(state: GameState): Mechanic[] {
  const out: Mechanic[] = [];
  for (const id of activeMechanicIds(state)) {
    const m = REGISTRY.get(id);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Whether any piece-augmenting mechanic is active for `state`. The gate on the
 * decision-1 attack/move fold: false (one .size check) whenever no augmenting
 * mechanic is even registered, so classical and phasing-only play pay nothing.
 */
export function augmentsActive(state: GameState): boolean {
  if (AUGMENTING_IDS.size === 0) return false;
  // Read state.mechanics directly (no `?? default` allocation on the hot path): a
  // legacy/default state has no mechanics field and is never augmenting (phasing only).
  const ids = state.mechanics;
  if (!ids) return false;
  for (const id of ids) {
    if (AUGMENTING_IDS.has(id)) return true;
  }
  return false;
}

/**
 * Augmented pseudo-moves for `piece` on `from`, folded over all active augmenting
 * mechanics. Call ONLY behind `augmentsActive` — dormant in Stage 1 (no mechanic
 * augments), exercised by boost in Stage 3.
 */
export function augmentedMoves(state: GameState, from: SquareIndex, piece: Piece): Move[] {
  const out: Move[] = [];
  for (const m of activeMechanics(state)) {
    const r = m.pieceMovesAndAttacks?.(state, from, piece);
    if (r) out.push(...r.moves);
  }
  return out;
}

/**
 * Whether `sq` is attacked by an augmented piece of `byColor`, folded over all
 * active augmenting mechanics. Call ONLY behind `augmentsActive`. This is the half
 * that keeps move-gen and check detection in lockstep (decision 1). Dormant in
 * Stage 1; exercised by boost in Stage 3.
 */
export function augmentedAttack(state: GameState, sq: SquareIndex, byColor: Color): boolean {
  for (const m of activeMechanics(state)) {
    if (!m.pieceMovesAndAttacks) continue;
    for (let from = 0; from < 64; from++) {
      const p = state.board[from];
      if (!p || p.color !== byColor) continue;
      const r = m.pieceMovesAndAttacks(state, from, p);
      if (r && r.attacks.includes(sq)) return true;
    }
  }
  return false;
}

/** The mechanic that owns `action` (a non-"move" action), or undefined. */
export function mechanicForAction(state: GameState, action: Action): Mechanic | undefined {
  return activeMechanics(state).find((m) => m.ownsAction?.(action));
}
