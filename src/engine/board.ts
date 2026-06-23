// Board geometry helpers and the initial position.

import { DEFAULT_RULE_CONFIG } from "./types.js";
import type { GameState, Piece, RuleConfig, SquareIndex } from "./types.js";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export function fileOf(sq: SquareIndex): number {
  return sq & 7;
}

export function rankOf(sq: SquareIndex): number {
  return sq >> 3;
}

export function squareIndex(file: number, rank: number): SquareIndex {
  return rank * 8 + file;
}

export function onBoard(file: number, rank: number): boolean {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** Convert an algebraic square like "e4" to a 0..63 index. */
export function parseSquare(alg: string): SquareIndex {
  const file = alg.charCodeAt(0) - 97; // 'a'
  const rank = alg.charCodeAt(1) - 49; // '1'
  if (!onBoard(file, rank)) throw new Error(`invalid square: ${alg}`);
  return squareIndex(file, rank);
}

/** Convert a 0..63 index to algebraic, e.g. 0 -> "a1". */
export function toAlgebraic(sq: SquareIndex): string {
  return `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
}

/** Safe board read: returns the piece or null. Throws on out-of-range index. */
export function pieceAt(board: (Piece | null)[], sq: SquareIndex): Piece | null {
  const p = board[sq];
  if (p === undefined) throw new Error(`square index out of range: ${sq}`);
  return p;
}

function emptyBoard(): (Piece | null)[] {
  return new Array<Piece | null>(64).fill(null);
}

const BACK_RANK: Piece["type"][] = ["r", "n", "b", "q", "k", "b", "n", "r"];

function cloneConfig(config: RuleConfig): RuleConfig {
  return { maxPhaseDuration: { ...config.maxPhaseDuration } };
}

/**
 * The standard chess starting position, wrapped in a fresh GameState. An optional
 * RuleConfig sets the game's ruleset (Tier-1 Settings); defaults to
 * DEFAULT_RULE_CONFIG. The config is cloned so callers can't mutate engine state.
 */
export function initialState(config: RuleConfig = DEFAULT_RULE_CONFIG): GameState {
  const board = emptyBoard();
  for (let file = 0; file < 8; file++) {
    board[squareIndex(file, 0)] = { color: "w", type: BACK_RANK[file]! };
    board[squareIndex(file, 1)] = { color: "w", type: "p" };
    board[squareIndex(file, 6)] = { color: "b", type: "p" };
    board[squareIndex(file, 7)] = { color: "b", type: BACK_RANK[file]! };
  }
  return {
    board,
    config: cloneConfig(config),
    turn: "w",
    status: "active",
    wonBySelfCapture: false,
    lastEvent: null,
    phased: [],
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    turnsTaken: { w: 0, b: 0 },
    captured: { w: [], b: [] },
  };
}

export function cloneState(state: GameState): GameState {
  return {
    board: state.board.slice(),
    // Preserve config faithfully (undefined for legacy states; the engine treats
    // absence as DEFAULT_RULE_CONFIG).
    config: state.config ? cloneConfig(state.config) : undefined,
    turn: state.turn,
    status: state.status,
    wonBySelfCapture: state.wonBySelfCapture,
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    phased: state.phased.map((p) => ({ ...p })),
    castling: { ...state.castling },
    enPassant: state.enPassant,
    turnsTaken: { ...state.turnsTaken },
    captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
  };
}

export function opponent(color: GameState["turn"]): GameState["turn"] {
  return color === "w" ? "b" : "w";
}
