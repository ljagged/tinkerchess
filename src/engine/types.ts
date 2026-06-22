// Core types for the Phase Chess rules engine.
//
// The engine is pure and headless: every function takes a GameState and returns
// data or a new GameState. No I/O, no randomness, no hidden mutation of inputs.
// This is the single source of truth for the variant's rules; the Convex layer
// and the frontend both consume it (the frontend only ever sees a *filtered*
// view — see the fog-of-war notes in the plan).

export type Color = "w" | "b";

/** Piece kinds. 'p' pawns cannot phase; everything else can. */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  color: Color;
  type: PieceType;
}

/**
 * Square index 0..63. index = rank * 8 + file, with file 0 = 'a', rank 0 = '1'.
 * So 'a1' = 0, 'h1' = 7, 'a8' = 56, 'h8' = 63.
 */
export type SquareIndex = number;

/** A piece that is currently phased out (off the board, hidden from the opponent). */
export interface PhasedPiece {
  color: Color;
  type: PieceType;
  /** Square the piece left and will reappear on. */
  origin: SquareIndex;
  /**
   * The owner's turn count at the END of which the piece phases back in. The
   * piece returns once the owner has completed `returnOn` turns, i.e. when
   * turnsTaken[owner] reaches this value. So phasing on the owner's turn k for
   * duration d sets returnOn = k + d, and the piece is absent across the owner's
   * turns k+1 … k+d, reappearing at the end of turn k+d.
   */
  returnOn: number;
}

export interface CastlingRights {
  wK: boolean; // white kingside
  wQ: boolean; // white queenside
  bK: boolean; // black kingside
  bQ: boolean; // black queenside
}

export type GameStatus = "active" | "w_won" | "b_won";

/** A non-terminal "footgun": a phase-in removed one of the owner's OWN pieces. */
export interface SelfCaptureEvent {
  by: Color;
  piece: PieceType;
  square: SquareIndex;
}

export interface GameState {
  /** 64 squares; holds only IN-PLAY pieces. Phased pieces are absent here. */
  board: (Piece | null)[];
  /** Whose turn it is to act. */
  turn: Color;
  status: GameStatus;
  /**
   * True when the game ended because the losing side captured their OWN king
   * (a phase-in landing on it) rather than the winner capturing it.
   */
  wonBySelfCapture: boolean;
  /**
   * The most recent non-terminal self-capture, or null. Reflects only the most
   * recently applied action (cleared each turn). Used to surface "X captured
   * their own rook" to both players.
   */
  lastEvent: SelfCaptureEvent | null;
  /** Pieces currently phased out, for both colors. */
  phased: PhasedPiece[];
  castling: CastlingRights;
  /** En-passant target square (the square a pawn skipped over), or null. */
  enPassant: SquareIndex | null;
  /** Completed turns per color. Incremented when a player finishes an action. */
  turnsTaken: { w: number; b: number };
}

/** A normal chess move. `promotion` is required only when a pawn reaches the last rank. */
export interface Move {
  from: SquareIndex;
  to: SquareIndex;
  promotion?: Exclude<PieceType, "p" | "k">;
}

/** A phase-out action: take a non-pawn piece off the board for `duration` of the owner's turns. */
export interface PhaseOut {
  from: SquareIndex;
  duration: number;
}

export type Action =
  | { kind: "move"; move: Move }
  | { kind: "phaseOut"; phaseOut: PhaseOut };

/** Maximum phase-out duration per piece type, in the owner's own turns. */
export const MAX_PHASE_DURATION: Record<Exclude<PieceType, "p">, number> = {
  k: 1,
  n: 2,
  b: 2,
  r: 3,
  q: 4,
};
