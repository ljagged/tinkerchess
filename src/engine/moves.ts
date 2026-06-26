// Pseudo-move generation and board mechanics for normal moves.
//
// Standard chess rules apply: a move is legal only if it leaves the mover's own
// king safe (see legalMovesFrom / kingSafe), and a king is never a capturable
// target. `generateMoves` produces PSEUDO-legal moves; `legalMovesFrom` filters
// them for king safety. Castling keeps the standard not-in/through/into-check
// constraints, extended so an enemy imminent-return ring counts like an attacked
// square (a king cannot castle into or through a ringed square).
//
// applyMove performs the board mechanics only. It does NOT flip the turn or
// touch the turn counters / phase timers — game.ts orchestrates that, and the
// end-of-turn phase-in resolution lives there.

import {
  cloneState,
  fileOf,
  onBoard,
  pieceAt,
  rankOf,
  squareIndex,
} from "./board.js";
import { isAttacked } from "./attacks.js";
import { kingSafe, warningSquaresFor } from "./phase.js";
import { augmentsActive, augmentedMoves } from "./mechanic.js";
import type {
  Color,
  GameEvent,
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
  const moves = classicalMoves(state, from, piece);
  // The decision-1 fold: a move-augmenting mechanic (boost; Stage 3) contributes the
  // SAME function isAttacked folds over, so move-gen and check detection never desync.
  // Gated — dormant (zero cost) when no augmenting mechanic is active.
  if (augmentsActive(state)) moves.push(...augmentedMoves(state, from, piece));
  return moves;
}

/** The always-on classical pseudo-moves for `piece` on `from`. */
function classicalMoves(state: GameState, from: SquareIndex, piece: Piece): Move[] {
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
  // An enemy imminent-return ring counts like an attacked square: the king may
  // not castle into or through a ringed square (it would be a S5a check there).
  const rings = warningSquaresFor(state, color);
  const empty = (file: number) => !pieceAt(state.board, squareIndex(file, rank));
  const safe = (file: number) => {
    const sq = squareIndex(file, rank);
    return !isAttacked(state, sq, enemy) && !rings.includes(sq);
  };
  const rights = state.castling;

  // King may not castle out of check (standard attack or an enemy ring on it).
  if (!kingSafe(state, color)) return moves;

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

/**
 * Fully-legal moves for the piece on `from`: pseudo-moves that do NOT capture a
 * king (no king is ever a legal target — S9) and that leave the mover's own king
 * safe (not in check, not on an enemy ring — kingSafe). This is where standard
 * chess king-safety is restored, and where the S5a ringed-king "flight only" rule
 * falls out for free: any non-king move that leaves the king on a ringed square
 * fails kingSafe and is filtered out.
 */
export function legalMovesFrom(state: GameState, from: SquareIndex): Move[] {
  const piece = pieceAt(state.board, from);
  if (!piece) return [];
  const mover = piece.color;
  return generateMoves(state, from).filter((m) => {
    const target = pieceAt(state.board, m.to);
    if (target && target.type === "k") return false; // a king is never a legal target
    return kingSafe(applyMove(state, m), mover);
  });
}

/** True if `move` is fully legal (king-safe and not a king capture). */
export function isLegalMove(state: GameState, move: Move): boolean {
  return legalMovesFrom(state, move.from).some(
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

  // Record captured pieces (normal capture and/or en passant). A king is never a
  // legal capture target (see legalMovesFrom), so no king is ever recorded here.
  if (captured) next.captured[captured.color].push(captured.type);
  if (enPassantCapture) next.captured[enPassantCapture.color].push(enPassantCapture.type);

  return next;
}

/**
 * Derive the move event (capture, en-passant, castle, promotion) from the
 * pre-state and the move. Pure; does not mutate. The `check` / `checkmate` flags
 * are NOT set here — they depend on the FINAL post-return board the opponent will
 * face, so they are stamped during adjudication in game.ts.
 */
export function deriveMoveEvent(pre: GameState, move: Move): GameEvent {
  const piece = pieceAt(pre.board, move.from);
  if (!piece) throw new Error(`no piece on square ${move.from}`);
  const fromFile = fileOf(move.from);
  const toFile = fileOf(move.to);
  const isPawn = piece.type === "p";
  const isKing = piece.type === "k";

  let capture: { color: Color; type: PieceType } | undefined;
  let enPassant = false;
  const normal = pieceAt(pre.board, move.to);
  if (normal) {
    capture = { color: normal.color, type: normal.type };
  } else if (isPawn && move.to === pre.enPassant && fromFile !== toFile) {
    const ep = pieceAt(pre.board, squareIndex(toFile, rankOf(move.from)));
    if (ep) {
      capture = { color: ep.color, type: ep.type };
      enPassant = true;
    }
  }

  const castle: "K" | "Q" | undefined =
    isKing && Math.abs(toFile - fromFile) === 2 ? (toFile === 6 ? "K" : "Q") : undefined;
  const promotion: Exclude<PieceType, "p" | "k"> | undefined =
    isPawn && (rankOf(move.to) === 0 || rankOf(move.to) === 7) ? move.promotion ?? "q" : undefined;

  return {
    kind: "move",
    color: piece.color,
    piece: piece.type,
    from: move.from,
    to: move.to,
    ...(capture ? { capture } : {}),
    ...(enPassant ? { enPassant: true as const } : {}),
    ...(castle ? { castle } : {}),
    ...(promotion ? { promotion } : {}),
  };
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
