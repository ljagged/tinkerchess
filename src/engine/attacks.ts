// Attack detection. Standard chess check/checkmate applies, so these predicates
// drive king safety everywhere: the legal-move filter, checkmate/stalemate
// adjudication, the phase-out-exposure check (S7), and castling constraints.
// Phased pieces are off `board`, so they never attack — this falls out for free
// since we only scan `board`. (The enemy imminent-return ring is handled
// separately as a per-square check, NOT in attack generation — see kingSafe.)

import { fileOf, onBoard, pieceAt, rankOf, squareIndex } from "./board.js";
import type { Color, GameState, SquareIndex } from "./types.js";

const KNIGHT_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

const KING_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

const DIAGONALS: ReadonlyArray<[number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const ORTHOGONALS: ReadonlyArray<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** True if `sq` is attacked by any in-play piece of `byColor`. */
export function isAttacked(
  state: GameState,
  sq: SquareIndex,
  byColor: Color,
): boolean {
  const board = state.board;
  const f = fileOf(sq);
  const r = rankOf(sq);

  // Pawns: a byColor pawn attacks `sq` from the rank "behind" its advance.
  const pawnFromRank = byColor === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    if (onBoard(f + df, pawnFromRank)) {
      const p = pieceAt(board, squareIndex(f + df, pawnFromRank));
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }

  // Knights.
  for (const [df, dr] of KNIGHT_OFFSETS) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = pieceAt(board, squareIndex(f + df, r + dr));
    if (p && p.color === byColor && p.type === "n") return true;
  }

  // Enemy king adjacency.
  for (const [df, dr] of KING_OFFSETS) {
    if (!onBoard(f + df, r + dr)) continue;
    const p = pieceAt(board, squareIndex(f + df, r + dr));
    if (p && p.color === byColor && p.type === "k") return true;
  }

  // Sliding pieces: diagonal (bishop/queen) and orthogonal (rook/queen).
  if (slidingHit(state, f, r, DIAGONALS, byColor, "b")) return true;
  if (slidingHit(state, f, r, ORTHOGONALS, byColor, "r")) return true;

  return false;
}

function slidingHit(
  state: GameState,
  f: number,
  r: number,
  directions: ReadonlyArray<[number, number]>,
  byColor: Color,
  sliderType: "b" | "r",
): boolean {
  const board = state.board;
  for (const [df, dr] of directions) {
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = pieceAt(board, squareIndex(nf, nr));
      if (p) {
        if (p.color === byColor && (p.type === sliderType || p.type === "q")) {
          return true;
        }
        break; // first piece blocks the ray
      }
      nf += df;
      nr += dr;
    }
  }
  return false;
}

/** Find the in-play king square for `color`, or null if it has been captured/phased. */
export function findKing(state: GameState, color: Color): SquareIndex | null {
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (p && p.color === color && p.type === "k") return sq;
  }
  return null;
}

/** True if `color`'s in-play king is currently attacked. False if the king is phased/off-board. */
export function inCheck(state: GameState, color: Color): boolean {
  const k = findKing(state, color);
  if (k === null) return false;
  return isAttacked(state, k, color === "w" ? "b" : "w");
}
