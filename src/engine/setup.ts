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

import type { Piece, SetupConfig, SquareIndex } from "./types.js";

/** Where castling's pieces start, as FILES (0=a .. 7=h). Classical: king e, rooks a/h. */
export interface CastlingHomeFiles {
  king: number;
  /** Queenside ("a-side") rook's home file. */
  aRook: number;
  /** Kingside ("h-side") rook's home file. */
  hRook: number;
}

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
