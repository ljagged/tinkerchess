// Handcrafted evaluation: a side-relative scalar over a reconstructed GameState.
//
// Standard chess material + a light positional (piece-square) term, PLUS the
// TinkerChess-specific terms the variant forces (spec §5). The eval reads the
// reconstructed state from view.ts, so an "enemy phased piece" here is an ASSUMED
// one — its timer came from assumeEnemyTimer, not from hidden truth.
//
// All magic numbers live in DEFAULT_WEIGHTS so they are named and individually
// tunable (weight tuning is deferred to a later step). evaluate() returns a score
// from `color`'s perspective: positive favours `color`.

import {
  cloneState,
  fileOf,
  findKing,
  isAttacked,
  isPhaseable,
  pieceAt,
  rankOf,
  validatePhaseOut,
  DEFAULT_RULE_CONFIG,
} from "../engine/index.js";
import type { Color, GameState, PieceType, RuleConfig, SquareIndex } from "../engine/index.js";

export interface EvalWeights {
  /** Base material value per piece type (centipawns). King is 0 (its loss is mate). */
  pieceValue: Record<PieceType, number>;
  /**
   * Phased-piece discount steepness (§5.1): a phased piece is worth
   * pieceValue * 1/(1 + phaseDiscountK * turnsRemaining) — nothing now, full value
   * on return. Applied to BOTH colors' phased pieces.
   */
  phaseDiscountK: number;
  /** Per-piece central-occupation bonus weight (piece-square proxy). */
  centerBonus: Record<PieceType, number>;
  /**
   * Threat model (§5.2/§5.3). A piece attacked and undefended is penalised. If it
   * can escape by phasing (phase-eligible, owner not in check, not absolutely
   * pinned) the penalty is only tempo + absence; otherwise — delivered with check,
   * absolutely pinned, or a pawn — it is the full piece value (genuinely hanging).
   */
  threatTempo: number;
  threatAbsence: Record<PieceType, number>;
  /** Ring-near-king weight (§5.4); doubled when the return is imminent (a live ring). */
  ringNearKing: number;
  /**
   * EXPERIMENT KNOB — flat centipawn bonus per OWN phased piece. Default 0, so the
   * term vanishes and play is byte-identical to the shipped bot. Raising it offsets
   * the §5.1 discount and makes the bot phase more aggressively, to study whether
   * more phasing helps (experiments/ only — never set in production play).
   */
  phaseBias: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  pieceValue: { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 },
  phaseDiscountK: 0.5,
  centerBonus: { p: 6, n: 12, b: 8, r: 2, q: 4, k: 0 },
  threatTempo: 30,
  threatAbsence: { p: 100, n: 40, b: 40, r: 60, q: 80, k: 0 },
  ringNearKing: 45,
  phaseBias: 0,
};

const sign = (c: Color): number => (c === "w" ? 1 : -1);
const configOf = (s: GameState): RuleConfig => s.config ?? DEFAULT_RULE_CONFIG;
const chebyshev = (a: SquareIndex, b: SquareIndex): number =>
  Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
// Distance from board centre, 0 (centre) .. 3 (corner-ish); smaller is more central.
const centrality = (sq: SquareIndex): number => {
  const df = Math.min(Math.abs(fileOf(sq) - 3), Math.abs(fileOf(sq) - 4));
  const dr = Math.min(Math.abs(rankOf(sq) - 3), Math.abs(rankOf(sq) - 4));
  return df + dr;
};

/**
 * Can `owner` save the piece on `sq` by phasing it out? Probes the engine's own
 * validatePhaseOut as if it were the owner's turn (eligibility is turn-relative),
 * so absolute pins and being-in-check (which blocks the escape, §5.3) fall out of
 * the real rule — no reimplementation.
 */
function canPhaseEscape(state: GameState, sq: SquareIndex, owner: Color): boolean {
  const piece = pieceAt(state.board, sq);
  if (!piece || piece.type === "p" || !isPhaseable(piece.type, configOf(state))) return false;
  const probe = cloneState(state);
  probe.turn = owner;
  probe.status = "active";
  return validatePhaseOut(probe, { from: sq, duration: 1 }).ok;
}

/** White-relative material: in-play pieces at full value, phased pieces discounted (§5.1). */
function materialTerm(state: GameState, w: EvalWeights): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (p) score += sign(p.color) * w.pieceValue[p.type];
  }
  for (const ph of state.phased) {
    const turnsRemaining = Math.max(0, ph.returnOn - state.turnsTaken[ph.color]);
    const discount = 1 / (1 + w.phaseDiscountK * turnsRemaining);
    score += sign(ph.color) * w.pieceValue[ph.type] * discount;
  }
  return score;
}

/** White-relative central-occupation bonus (a light piece-square stand-in). */
function positionalTerm(state: GameState, w: EvalWeights): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (!p || w.centerBonus[p.type] === 0) continue;
    score += sign(p.color) * w.centerBonus[p.type] * (3 - centrality(sq));
  }
  return score;
}

/**
 * White-relative threat term (§5.2/§5.3). For each side, an attacked-and-undefended
 * non-king piece is penalised — by the full value if it cannot phase to safety, or
 * just tempo + absence if it can. This is the term that keeps the bot from
 * panic-defending a piece it could simply phase, and from over-valuing its own
 * quiet attacks on phase-eligible enemy pieces.
 */
function threatTerm(state: GameState, w: EvalWeights): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (!p || p.type === "k") continue;
    const enemy: Color = p.color === "w" ? "b" : "w";
    const attacked = isAttacked(state, sq, enemy);
    if (!attacked) continue;
    const defended = isAttacked(state, sq, p.color);
    if (defended) continue; // crude hanging check (no SEE in v1)
    const penalty = canPhaseEscape(state, sq, p.color)
      ? w.threatTempo + w.threatAbsence[p.type]
      : w.pieceValue[p.type];
    score -= sign(p.color) * penalty;
  }
  return score;
}

/**
 * White-relative ring term (§5.4): a phased piece whose origin sits on or next to
 * the ENEMY king is offensive pressure for its owner — the only way phasing bears
 * on a king (the "ringed mate" motif). Doubled when the return is imminent (it
 * resolves at the end of the owner's next turn — a live warning ring). The same
 * sum scores own-king danger: an enemy phased piece next to your king is negative.
 */
function ringTerm(state: GameState, w: EvalWeights): number {
  let score = 0;
  for (const ph of state.phased) {
    const enemy: Color = ph.color === "w" ? "b" : "w";
    const enemyKing = findKing(state, enemy);
    if (enemyKing === null || chebyshev(ph.origin, enemyKing) > 1) continue;
    const imminent = ph.returnOn === state.turnsTaken[ph.color] + 1 ? 2 : 1;
    score += sign(ph.color) * w.ringNearKing * imminent;
  }
  return score;
}

/** EXPERIMENT-only term: a flat bonus per own phased piece (w.phaseBias). Zero by
 *  default, so it vanishes and the eval is identical to the shipped bot. Because the
 *  search root evaluates EVERY candidate action, a positive bias is enough to make
 *  the bot choose phase-outs — no move-ordering change needed. */
function phaseBiasTerm(state: GameState, w: EvalWeights): number {
  if (w.phaseBias === 0) return 0;
  let score = 0;
  for (const ph of state.phased) score += sign(ph.color) * w.phaseBias;
  return score;
}

/**
 * Evaluate `state` from `color`'s perspective (positive favours `color`). Note
 * §5.5 (phase-out tempo cost) is realised structurally rather than as a term: a
 * phased own piece is already discounted here (§5.1), and search orders phase-outs
 * last — so a speculative phase-out scores worse than a developing move without a
 * dedicated penalty. (The phaseBias term is an opt-in experiment knob, 0 by default.)
 */
export function evaluate(
  state: GameState,
  color: Color,
  weights: EvalWeights = DEFAULT_WEIGHTS,
): number {
  const whiteRelative =
    materialTerm(state, weights) +
    positionalTerm(state, weights) +
    threatTerm(state, weights) +
    ringTerm(state, weights) +
    phaseBiasTerm(state, weights);
  return sign(color) * whiteRelative;
}
