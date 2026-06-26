// Classical-chess interop for the Stockfish experiment (experiments/). NOT used by
// the app or the variant rules — it exists only to let a classical UCI engine play
// the TinkerChess board.
//
// The trick: Stockfish never needs to understand phasing. Each of its turns we hand
// it a fresh FEN of the CURRENT 64-square board (phased pieces are simply absent, so
// it sees the side as temporarily down material), take its bestmove, and map it back
// to a classical TC move. Phase-ins never need a UCI representation because Stockfish
// is re-fed the board, not the move history.

import { parseSquare, pieceAt, toAlgebraic, legalMoves } from "./index.js";
import type { GameState, Move, PieceType } from "./index.js";

const FEN_PIECE: Record<PieceType, string> = { p: "p", n: "n", b: "b", r: "r", q: "q", k: "k" };

/**
 * Render the visible board as a standard FEN. Phased pieces are off-board, so they
 * do not appear (correct: a classical engine sees the current material). The halfmove
 * clock is 0 (TC has no 50-move rule) and the fullmove number is synthesized from
 * turnsTaken — neither affects move choice materially.
 */
export function toFEN(state: GameState): string {
  const ranks: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieceAt(state.board, r * 8 + f);
      if (!p) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const ch = FEN_PIECE[p.type];
      row += p.color === "w" ? ch.toUpperCase() : ch;
    }
    if (empty > 0) row += String(empty);
    ranks.push(row);
  }
  const c = state.castling;
  const castle = `${c.wK ? "K" : ""}${c.wQ ? "Q" : ""}${c.bK ? "k" : ""}${c.bQ ? "q" : ""}` || "-";
  const ep = state.enPassant === null ? "-" : toAlgebraic(state.enPassant);
  const fullmove = Math.floor((state.turnsTaken.w + state.turnsTaken.b) / 2) + 1;
  return `${ranks.join("/")} ${state.turn} ${castle} ${ep} 0 ${fullmove}`;
}

const PROMO = new Set<string>(["n", "b", "r", "q"]);

/** Parse a UCI move ("e2e4", "e7e8q", castling as "e1g1") into a classical TC Move. */
export function uciToMove(uci: string): Move {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const promo = uci.slice(4, 5);
  if (promo && PROMO.has(promo)) {
    return { from, to, promotion: promo as Exclude<PieceType, "p" | "k"> };
  }
  return { from, to };
}

/** Render a classical TC Move as a UCI string. */
export function moveToUci(move: Move): string {
  return toAlgebraic(move.from) + toAlgebraic(move.to) + (move.promotion ?? "");
}

/**
 * Is `move` actually legal in the TC position? A classical engine can't see the
 * ring rule (an incoming return forbidding a king move/castle), so a Stockfish
 * bestmove must be checked against TC's own `legalMoves` before it's applied. The
 * match driver requests MultiPV and takes the top legal line on the rare miss.
 */
export function isTcLegal(state: GameState, move: Move): boolean {
  return legalMoves(state).some(
    (m) => m.from === move.from && m.to === move.to && (m.promotion ?? null) === (move.promotion ?? null),
  );
}
