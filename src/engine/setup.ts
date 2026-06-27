// The setup registry — the kernel's extension seam for the one-time SETUP axis
// (which starting position a game begins from). Orthogonal to mechanics: a setup runs
// ONCE at game creation to lay out the board and declare where castling's king/rooks
// start; mechanics fold over every turn. Classical is plugin #1; Chess960 (Stage 2)
// registers the same way and supplies a shuffled back rank + non-standard home files.
//
// `castlingHomeFiles` is the seam decision-5 needs: classical castling is the special
// case (king e, rooks a/h). Stage 2 makes castling READ these files instead of
// hard-coding e1/a1/h1, so a shuffled rank castles correctly. In Stage 1 the registry
// exists and classical is registered; castling still reads its classical home squares
// directly (wired to these files in Stage 2).

import type { CastlingHomeFiles, Piece, SetupConfig } from "./types.js";

export type { CastlingHomeFiles };

export interface BuiltSetup {
  /** A fresh 64-square board with both armies placed. */
  board: (Piece | null)[];
  castlingHomeFiles: CastlingHomeFiles;
}

export interface Setup {
  readonly id: string;
  /** Lay out the starting position for this setup (and its config, e.g. a 960 number). */
  build(cfg: SetupConfig): BuiltSetup;
}

const REGISTRY = new Map<string, Setup>();

export function registerSetup(setup: Setup): void {
  REGISTRY.set(setup.id, setup);
}

export function getSetup(id: string): Setup | undefined {
  return REGISTRY.get(id);
}

const CLASSICAL_BACK_RANK: Piece["type"][] = ["r", "n", "b", "q", "k", "b", "n", "r"];

/** Build a standard chess starting position from a back-rank file→type array. */
export function buildFromBackRank(backRank: Piece["type"][]): (Piece | null)[] {
  const board = new Array<Piece | null>(64).fill(null);
  for (let file = 0; file < 8; file++) {
    board[file] = { color: "w", type: backRank[file]! }; // rank 0
    board[8 + file] = { color: "w", type: "p" }; // rank 1
    board[48 + file] = { color: "b", type: "p" }; // rank 6
    board[56 + file] = { color: "b", type: backRank[file]! }; // rank 7
  }
  return board;
}

/** Find the castling home files implied by a back rank (king + the two rooks). */
export function homeFilesFromBackRank(backRank: Piece["type"][]): CastlingHomeFiles {
  const king = backRank.indexOf("k");
  const aRook = backRank.indexOf("r"); // leftmost rook (queenside)
  const hRook = backRank.lastIndexOf("r"); // rightmost rook (kingside)
  return { king, aRook, hRook };
}

/** Classical chess: the standard back rank, king on e, rooks on a/h. */
export const classicalSetup: Setup = {
  id: "classical",
  build() {
    return {
      board: buildFromBackRank(CLASSICAL_BACK_RANK),
      castlingHomeFiles: homeFilesFromBackRank(CLASSICAL_BACK_RANK),
    };
  },
};

registerSetup(classicalSetup);

// --- Chess960 (Fischer random) ----------------------------------------------
// Scharnagl numbering: a bijection between 0..959 and the 960 legal starting back
// ranks (bishops on opposite colors, king between the rooks). #518 is the classical
// RNBQKBNR; #198 is QNBRKBNR. The decode is deterministic — "random" selection picks
// a number at the (impure) Convex layer and stores it in SetupConfig.position, so the
// engine itself stays pure.

export const CHESS960_POSITIONS = 960;

// The 10 ways to place two (identical) knights among 5 remaining empty squares,
// as index pairs into the empty-square list, in Scharnagl's canonical order.
const KNIGHT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [0, 3], [0, 4],
  [1, 2], [1, 3], [1, 4],
  [2, 3], [2, 4],
  [3, 4],
];

/** The n-th (0-indexed) still-empty file in `rank`, or -1 if fewer than n+1 remain. */
function nthEmptyFile(rank: (Piece["type"] | null)[], n: number): number {
  let seen = 0;
  for (let f = 0; f < 8; f++) {
    if (rank[f] === null) {
      if (seen === n) return f;
      seen++;
    }
  }
  return -1;
}

/**
 * The Chess960 back rank for Scharnagl position number `n` (0..959). Places the two
 * bishops (opposite colors), the queen, the knights, then rook-king-rook left to
 * right into the remaining files (so the king always sits between the rooks).
 */
export function scharnaglBackRank(n: number): Piece["type"][] {
  const num = ((Math.floor(n) % CHESS960_POSITIONS) + CHESS960_POSITIONS) % CHESS960_POSITIONS;
  const rank: (Piece["type"] | null)[] = new Array(8).fill(null);

  const b1 = num % 4; // light-square bishop: files 1,3,5,7
  rank[b1 * 2 + 1] = "b";
  const n2 = Math.floor(num / 4);
  const b2 = n2 % 4; // dark-square bishop: files 0,2,4,6
  rank[b2 * 2] = "b";

  const n3 = Math.floor(n2 / 4);
  const q = n3 % 6; // queen in the q-th remaining empty file
  rank[nthEmptyFile(rank, q)] = "q";

  const n4 = Math.floor(n3 / 6); // 0..9 → which knight pair
  const [k1, k2] = KNIGHT_PAIRS[n4]!;
  // Resolve both knight files against the SAME empty list before placing either.
  const kf1 = nthEmptyFile(rank, k1);
  const kf2 = nthEmptyFile(rank, k2);
  rank[kf1] = "n";
  rank[kf2] = "n";

  // The three files still empty take rook, king, rook left→right (king between rooks).
  const r1 = nthEmptyFile(rank, 0);
  const k = nthEmptyFile(rank, 1);
  const r2 = nthEmptyFile(rank, 2);
  rank[r1] = "r";
  rank[k] = "k";
  rank[r2] = "r";

  return rank as Piece["type"][];
}

/**
 * Chess960: lays out the Scharnagl position in `cfg.position` (default #518 ⇒
 * classical if absent). Castling home files are derived from the shuffled back rank.
 */
export const chess960Setup: Setup = {
  id: "chess960",
  build(cfg) {
    const back = scharnaglBackRank(cfg.position ?? 518);
    return { board: buildFromBackRank(back), castlingHomeFiles: homeFilesFromBackRank(back) };
  },
};

registerSetup(chess960Setup);
