// Boost: the move-augmenting mechanic (plugin #2) — the first real exercise of the
// kernel's decision-1 attack/move fold. A boosted piece keeps its classical moves and
// gains a fairy upgrade for a standing 3-turn buff:
//
//   bishop → Dragon Horse  (bishop + wazir : + one orthogonal step)
//   knight → knight-ferz    (knight + ferz  : + one diagonal step)
//   rook   → Dragon King    (rook   + ferz  : + one diagonal step)
//   queen  → Amazon         (queen  + knight: + the knight leaps)
//   king   → 2-step king    (king slides up to two squares in any direction)
//
// The mechanic contributes ONE function — pieceMovesAndAttacks — returning only the
// EXTRA squares (the kernel already generates the classical moves). Move-gen folds in
// `.moves`; isAttacked folds in `.attacks` from the SAME function, so a boosted piece
// both reaches a square and gives check/bars the king there — they cannot desync
// (decision 1). The fold is gated on a boost actually being on the board (augmentsActive
// → state.mechanics includes "boost"), so classical/phasing play pays nothing.
//
// This file is Stage 3A: the fairy move/attack generation, the registry hook, and the
// search hash. The boost ACTION + sacrifice economy, the 3-turn expiry, eval and
// notation land in the following increments.

import { fileOf, onBoard, pieceAt, rankOf, squareIndex } from "./board.js";
import { registerMechanic, type Mechanic } from "./mechanic.js";
import type { BoostState, Color, FairyBase, GameState, Move, Piece, SquareIndex } from "./types.js";

const WAZIR: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FERZ: ReadonlyArray<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: ReadonlyArray<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const ALL_DIRS: ReadonlyArray<[number, number]> = [...WAZIR, ...FERZ];

/** The boost on `sq` for `color`, or undefined. */
export function boostAt(state: GameState, sq: SquareIndex, color: Color): BoostState | undefined {
  return state.boosts?.find((b) => b.square === sq && b.color === color);
}

/** Leaper target squares for `offsets` from `from` that stay on the board. */
function leaperTargets(from: SquareIndex, offsets: ReadonlyArray<[number, number]>): SquareIndex[] {
  const f = fileOf(from);
  const r = rankOf(from);
  const out: SquareIndex[] = [];
  for (const [df, dr] of offsets) {
    if (onBoard(f + df, r + dr)) out.push(squareIndex(f + df, r + dr));
  }
  return out;
}

/**
 * The 2-step king's EXTRA squares: the distance-2 square in each of the 8 directions,
 * reachable only when the intervening (distance-1) square is empty (it slides, it does
 * not leap). The distance-1 squares are already the classical king's moves.
 */
function twoStepKingTargets(state: GameState, from: SquareIndex, color: Color): SquareIndex[] {
  const f = fileOf(from);
  const r = rankOf(from);
  // A classical king on its home square reaching the castle destinations (g/c) would
  // be ambiguous with castling, which owns that gesture — so the 2-step king defers
  // those two squares to castle (it can still 2-step in every other direction).
  const homeKing = state.castlingHomeFiles?.king ?? 4;
  const homeRank = color === "w" ? 0 : 7;
  const collidesWithCastle = (to: SquareIndex) =>
    homeKing === 4 && f === 4 && r === homeRank && rankOf(to) === homeRank &&
    (fileOf(to) === 6 || fileOf(to) === 2);
  const out: SquareIndex[] = [];
  for (const [df, dr] of ALL_DIRS) {
    if (!onBoard(f + df, r + dr) || !onBoard(f + 2 * df, r + 2 * dr)) continue;
    if (pieceAt(state.board, squareIndex(f + df, r + dr))) continue; // blocked at distance 1
    const to = squareIndex(f + 2 * df, r + 2 * dr);
    if (collidesWithCastle(to)) continue;
    out.push(to);
  }
  return out;
}

/** The fairy upgrade's EXTRA target squares (beyond the classical piece) for `base`. */
function fairyTargets(state: GameState, from: SquareIndex, base: FairyBase, color: Color): SquareIndex[] {
  switch (base) {
    case "b": return leaperTargets(from, WAZIR); // Dragon Horse
    case "n": return leaperTargets(from, FERZ); // knight-ferz
    case "r": return leaperTargets(from, FERZ); // Dragon King
    case "q": return leaperTargets(from, KNIGHT); // Amazon
    case "k": return twoStepKingTargets(state, from, color); // 2-step king
  }
}

/**
 * Boost as a Mechanic. Stage 3A wires only the load-bearing seams: the augmented
 * move/attack fold and the search hash. (legalActions / applyAction / onTurnEnd / eval
 * / notation arrive in the next increments.)
 */
export const boostMechanic: Mechanic = {
  id: "boost",

  pieceMovesAndAttacks(state, from, piece) {
    const boost = boostAt(state, from, piece.color);
    if (!boost || boost.base !== piece.type) return null;

    const targets = fairyTargets(state, from, boost.base, piece.color);
    const moves: Move[] = [];
    const attacks: SquareIndex[] = [];
    for (const to of targets) {
      attacks.push(to); // the fairy attacks every reachable square (basis of check/mate)
      const occupant = pieceAt(state.board, to);
      // A move lands only on an empty or enemy square; king-capture and self-check are
      // filtered downstream by legalMovesFrom (the decision-1 correctness guarantee).
      if (!occupant || occupant.color !== piece.color) moves.push({ from, to });
    }
    return { moves, attacks };
  },

  stateHash(state) {
    // Boosts change a piece's reachable squares, so two positions with equal boards
    // but different boosts are NOT search-equivalent — the TT must separate them.
    if (!state.boosts || state.boosts.length === 0) return "";
    return state.boosts
      .map((b) => `${b.color}${b.base}${b.square}:${b.expiresOn}`)
      .sort()
      .join(",");
  },
};

registerMechanic(boostMechanic);

/** Helper for callers/tests: is the piece on `sq` boosted (for the given color)? */
export function isBoosted(state: GameState, sq: SquareIndex, color: Color): boolean {
  return boostAt(state, sq, color) !== undefined;
}

/** The fairy targets exposed for tests/eval (the EXTRA squares a boosted base reaches). */
export function fairyExtraTargets(state: GameState, from: SquareIndex, piece: Piece): SquareIndex[] {
  const boost = boostAt(state, from, piece.color);
  if (!boost || boost.base !== piece.type) return [];
  return fairyTargets(state, from, boost.base, piece.color);
}
