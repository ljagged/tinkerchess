// Pseudo-move generation and board mechanics for normal moves.
//
// Phase Chess divergences from standard chess that matter here:
//   - Capturing the enemy KING is a legal move and ends the game (no checkmate).
//   - There is NO "can't leave your king in check" filtering — moves are not
//     pruned for king safety. (Self-capture is *not* allowed on a normal move;
//     it only happens on phase-in, handled in phase.ts.)
//   - Castling keeps the standard not-in/through/into-check constraints.
//
// applyMove performs the board mechanics only. It does NOT flip the turn or
// touch the turn counters / phase timers — game.ts orchestrates that so the
// phase-in-at-start-of-turn rule lives in one place.

import {
  cloneState,
  fileOf,
  onBoard,
  pieceAt,
  rankOf,
  squareIndex,
} from "./board.js";
import { isAttacked } from "./attacks.js";
import type {
  Color,
  GameState,
  Move,
  Piece,
  PieceType,
  SquareIndex,
} from "./types.js";

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

const PROMO_TYPES: ReadonlyArray<Exclude<PieceType, "p" | "k">> = ["q", "r", "b", "n"];

/**
 * All pseudo-legal moves for the piece on `from`. The piece's own color is the
 * mover; the caller is responsible for ensuring it is that color's turn.
 * Returns [] if `from` is empty.
 */
export function generateMoves(state: GameState, from: SquareIndex): Move[] {
  const piece = pieceAt(state.board, from);
  if (!piece) return [];
  switch (piece.type) {
    case "p":
      return pawnMoves(state, from, piece.color);
    case "n":
      return stepMoves(state, from, piece.color, KNIGHT_OFFSETS);
    case "k":
      return [
        ...stepMoves(state, from, piece.color, KING_OFFSETS),
        ...castlingMoves(state, from, piece.color),
      ];
    case "b":
      return slideMoves(state, from, piece.color, DIAGONALS);
    case "r":
      return slideMoves(state, from, piece.color, ORTHOGONALS);
    case "q":
      return slideMoves(state, from, piece.color, [...DIAGONALS, ...ORTHOGONALS]);
  }
}

function stepMoves(
  state: GameState,
  from: SquareIndex,
  color: Color,
  offsets: ReadonlyArray<[number, number]>,
): Move[] {
  const moves: Move[] = [];
  const f = fileOf(from);
  const r = rankOf(from);
  for (const [df, dr] of offsets) {
    if (!onBoard(f + df, r + dr)) continue;
    const to = squareIndex(f + df, r + dr);
    const occupant = pieceAt(state.board, to);
    if (!occupant || occupant.color !== color) moves.push({ from, to });
  }
  return moves;
}

function slideMoves(
  state: GameState,
  from: SquareIndex,
  color: Color,
  directions: ReadonlyArray<[number, number]>,
): Move[] {
  const moves: Move[] = [];
  const f = fileOf(from);
  const r = rankOf(from);
  for (const [df, dr] of directions) {
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const to = squareIndex(nf, nr);
      const occupant = pieceAt(state.board, to);
      if (!occupant) {
        moves.push({ from, to });
      } else {
        if (occupant.color !== color) moves.push({ from, to }); // capture (incl. enemy king)
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  return moves;
}

function pawnMoves(state: GameState, from: SquareIndex, color: Color): Move[] {
  const moves: Move[] = [];
  const f = fileOf(from);
  const r = rankOf(from);
  const dir = color === "w" ? 1 : -1;
  const startRank = color === "w" ? 1 : 6;
  const lastRank = color === "w" ? 7 : 0;

  const pushPawnMove = (to: SquareIndex) => {
    if (rankOf(to) === lastRank) {
      for (const promotion of PROMO_TYPES) moves.push({ from, to, promotion });
    } else {
      moves.push({ from, to });
    }
  };

  // Forward one (and two from the start rank).
  const oneRank = r + dir;
  if (onBoard(f, oneRank) && !pieceAt(state.board, squareIndex(f, oneRank))) {
    pushPawnMove(squareIndex(f, oneRank));
    if (r === startRank) {
      const twoRank = r + 2 * dir;
      if (!pieceAt(state.board, squareIndex(f, twoRank))) {
        moves.push({ from, to: squareIndex(f, twoRank) });
      }
    }
  }

  // Diagonal captures (including en passant).
  for (const df of [-1, 1]) {
    if (!onBoard(f + df, oneRank)) continue;
    const to = squareIndex(f + df, oneRank);
    const occupant = pieceAt(state.board, to);
    if (occupant && occupant.color !== color) {
      pushPawnMove(to); // capture (incl. enemy king)
    } else if (!occupant && state.enPassant === to) {
      moves.push({ from, to }); // en passant; never a promotion rank
    }
  }

  return moves;
}

function castlingMoves(state: GameState, from: SquareIndex, color: Color): Move[] {
  const moves: Move[] = [];
  const homeKing = color === "w" ? squareIndex(4, 0) : squareIndex(4, 7);
  if (from !== homeKing) return moves;
  const enemy: Color = color === "w" ? "b" : "w";
  const rank = color === "w" ? 0 : 7;
  const empty = (file: number) => !pieceAt(state.board, squareIndex(file, rank));
  const safe = (file: number) => !isAttacked(state, squareIndex(file, rank), enemy);
  const rights = state.castling;

  // King may not castle out of check.
  if (isAttacked(state, homeKing, enemy)) return moves;

  // Kingside: squares f,g empty; king path e,f,g safe.
  const kingsideRight = color === "w" ? rights.wK : rights.bK;
  if (kingsideRight && empty(5) && empty(6) && safe(4) && safe(5) && safe(6)) {
    moves.push({ from, to: squareIndex(6, rank) });
  }
  // Queenside: squares b,c,d empty; king path e,d,c safe.
  const queensideRight = color === "w" ? rights.wQ : rights.bQ;
  if (
    queensideRight &&
    empty(1) && empty(2) && empty(3) &&
    safe(4) && safe(3) && safe(2)
  ) {
    moves.push({ from, to: squareIndex(2, rank) });
  }
  return moves;
}

/** True if (from,to,promotion) is among the generated pseudo-legal moves. */
export function isLegalMove(state: GameState, move: Move): boolean {
  return generateMoves(state, move.from).some(
    (m) => m.to === move.to && m.promotion === move.promotion,
  );
}

/**
 * Apply a normal move's board mechanics, returning a new state. Updates the
 * board, castling rights, en-passant target, and (if the enemy king is
 * captured) status. Does NOT flip the turn or resolve phase timers.
 */
export function applyMove(state: GameState, move: Move): GameState {
  const next = cloneState(state);
  const piece = pieceAt(next.board, move.from);
  if (!piece) throw new Error(`no piece on square ${move.from}`);

  const captured = pieceAt(next.board, move.to);
  const fromFile = fileOf(move.from);
  const toFile = fileOf(move.to);
  const isPawn = piece.type === "p";
  const isKing = piece.type === "k";

  // En-passant capture: pawn moves diagonally onto the en-passant target,
  // which is empty; the captured pawn sits behind it.
  let enPassantCapture: Piece | null = null;
  if (isPawn && move.to === state.enPassant && !captured && fromFile !== toFile) {
    const capturedSquare = squareIndex(toFile, rankOf(move.from));
    enPassantCapture = pieceAt(next.board, capturedSquare);
    next.board[capturedSquare] = null;
  }

  // Relocate the piece, applying promotion if a pawn reached the last rank.
  next.board[move.from] = null;
  if (isPawn && (rankOf(move.to) === 0 || rankOf(move.to) === 7)) {
    next.board[move.to] = { color: piece.color, type: move.promotion ?? "q" };
  } else {
    next.board[move.to] = piece;
  }

  // Castling: move the rook to the other side of the king.
  if (isKing && Math.abs(toFile - fromFile) === 2) {
    const rank = rankOf(move.from);
    if (toFile === 6) {
      next.board[squareIndex(5, rank)] = pieceAt(next.board, squareIndex(7, rank));
      next.board[squareIndex(7, rank)] = null;
    } else if (toFile === 2) {
      next.board[squareIndex(3, rank)] = pieceAt(next.board, squareIndex(0, rank));
      next.board[squareIndex(0, rank)] = null;
    }
  }

  updateCastlingRights(next, move, piece, captured);

  // En-passant target: only set on a pawn double-push.
  next.enPassant =
    isPawn && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2
      ? squareIndex(fromFile, (rankOf(move.from) + rankOf(move.to)) / 2)
      : null;

  // Record captured pieces (normal capture and/or en passant).
  if (captured) next.captured[captured.color].push(captured.type);
  if (enPassantCapture) next.captured[enPassantCapture.color].push(enPassantCapture.type);

  // Win by king capture (normal or en-passant — though a king is never taken en passant).
  const king = captured ?? enPassantCapture;
  if (king && king.type === "k") {
    next.status = king.color === "w" ? "b_won" : "w_won";
  }

  return next;
}

function updateCastlingRights(
  state: GameState,
  move: Move,
  piece: Piece,
  captured: Piece | null,
): void {
  const c = state.castling;
  if (piece.type === "k") {
    if (piece.color === "w") { c.wK = false; c.wQ = false; }
    else { c.bK = false; c.bQ = false; }
  }
  // A rook leaving its home corner forfeits that side.
  const corner = (sq: SquareIndex) => {
    if (sq === squareIndex(0, 0)) c.wQ = false;
    else if (sq === squareIndex(7, 0)) c.wK = false;
    else if (sq === squareIndex(0, 7)) c.bQ = false;
    else if (sq === squareIndex(7, 7)) c.bK = false;
  };
  if (piece.type === "r") corner(move.from);
  // A rook captured on its home corner also forfeits that side.
  if (captured && captured.type === "r") corner(move.to);
}
