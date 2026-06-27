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
import { CLASSICAL_HOME_FILES } from "./types.js";
import type {
  CastlingHomeFiles,
  Color,
  GameEvent,
  GameState,
  Move,
  Piece,
  PieceType,
  SquareIndex,
} from "./types.js";

/** This game's castling home files (absent ⇒ classical: king e, rooks a/h). */
function homeFiles(state: GameState): CastlingHomeFiles {
  return state.castlingHomeFiles ?? CLASSICAL_HOME_FILES;
}

/** Structural move equality (decision 5): from, to, promotion, AND the castle flag —
 *  so a normal king step and a same-square castle are never conflated (Chess960). */
export function movesEqual(a: Move, b: Move): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    (a.promotion ?? null) === (b.promotion ?? null) &&
    (a.castle ?? null) === (b.castle ?? null)
  );
}

/**
 * Which side `move` castles to, or null. The single castle-detection point: an
 * explicit flag (Chess960, king off the e-file) takes precedence; otherwise the
 * classical positional rule (king on the e-file moving exactly two files) applies —
 * keeping classical castle moves flag-free and byte-identical to before.
 */
function castleSideOf(state: GameState, move: Move, piece: Piece): "K" | "Q" | null {
  if (piece.type !== "k") return null;
  if (move.castle) return move.castle;
  // Classical positional rule: the king on its home SQUARE (e-file, home rank) moving
  // exactly two files. The home-rank guard matters once a 2-step king (boost) can move
  // two files elsewhere on the board — those are plain moves, never castles.
  const home = homeFiles(state);
  const homeRank = piece.color === "w" ? 0 : 7;
  if (home.king !== 4 || fileOf(move.from) !== 4 || rankOf(move.from) !== homeRank) return null;
  const df = fileOf(move.to) - 4;
  return df === 2 ? "K" : df === -2 ? "Q" : null;
}

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
  const home = homeFiles(state);
  const rank = color === "w" ? 0 : 7;
  if (from !== squareIndex(home.king, rank)) return moves;
  // King may not castle out of check (standard attack or an enemy ring on it).
  if (!kingSafe(state, color)) return moves;

  const enemy: Color = color === "w" ? "b" : "w";
  // An enemy imminent-return ring counts like an attacked square: the king may not
  // castle into or through a ringed square (it would be a S5a check there).
  const rings = warningSquaresFor(state, color);
  const rights = state.castling;
  // Chess960 (king off the e-file) needs the explicit flag, encoded king-onto-rook,
  // since positional detection is ambiguous. Classical (king on e) stays flag-free.
  const useFlag = home.king !== 4;

  // FIDE rule (classical and 960): the king lands on g (kingside) / c (queenside) and
  // the rook on f / d. Squares that must be EMPTY are the union of the king's and the
  // rook's travel paths, minus the king's and rook's own starting squares. Squares
  // that must be SAFE are the king's path (inclusive). The destination encoded in the
  // move is g/c classically, or the rook's square (king-onto-rook) in Chess960.
  const tryCastle = (side: "K" | "Q", rookFile: number, kingTo: number, rookTo: number) => {
    const right = side === "K" ? (color === "w" ? rights.wK : rights.bK)
                                : (color === "w" ? rights.wQ : rights.bQ);
    if (!right) return;
    const rook = pieceAt(state.board, squareIndex(rookFile, rank));
    if (!rook || rook.type !== "r" || rook.color !== color) return;

    const spanEmpty = (a: number, b: number) => {
      for (let f = Math.min(a, b); f <= Math.max(a, b); f++) {
        if (f === home.king || f === rookFile) continue; // king & castling rook may occupy their own paths
        if (pieceAt(state.board, squareIndex(f, rank))) return false;
      }
      return true;
    };
    if (!spanEmpty(home.king, kingTo)) return; // king's travel must be clear
    if (!spanEmpty(rookFile, rookTo)) return; // rook's travel must be clear

    for (let f = Math.min(home.king, kingTo); f <= Math.max(home.king, kingTo); f++) {
      const sq = squareIndex(f, rank);
      if (isAttacked(state, sq, enemy) || rings.includes(sq)) return; // king path must be safe
    }

    const to = useFlag ? squareIndex(rookFile, rank) : squareIndex(kingTo, rank);
    moves.push(useFlag ? { from, to, castle: side } : { from, to });
  };

  tryCastle("K", home.hRook, 6, 5);
  tryCastle("Q", home.aRook, 2, 3);
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

/** True if `move` is fully legal (king-safe and not a king capture). Compares the
 *  full move incl. the castle flag, so a Chess960 king-onto-rook castle is not
 *  conflated with any same-square non-castle move. */
export function isLegalMove(state: GameState, move: Move): boolean {
  return legalMovesFrom(state, move.from).some((m) => movesEqual(m, move));
}

/**
 * Resolve a client-/UCI-supplied intent ({from,to,promotion}, no castle flag) to the
 * canonical legal move — which carries the castle flag in Chess960. Returns null if
 * no legal move matches. Used by the server and bridges so the applied/recorded move
 * is always canonical (the engine's apply reads the flag, not geometry).
 */
export function resolveMove(
  state: GameState,
  intent: { from: SquareIndex; to: SquareIndex; promotion?: Move["promotion"] },
): Move | null {
  const matches = legalMovesFrom(state, intent.from).filter(
    (m) => m.to === intent.to && (m.promotion ?? null) === (intent.promotion ?? null),
  );
  return matches[0] ?? null;
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

  // Castling is its own branch: the king and rook land on g/f (kingside) or c/d
  // (queenside) regardless of where they started, and in Chess960 `move.to` is the
  // rook's square (king-onto-rook) — NOT a capture — so this must precede the normal
  // capture/relocate path. No capture, no en-passant target on a castle.
  const castleSide = castleSideOf(state, move, piece);
  if (castleSide) {
    applyCastle(next, move, piece, castleSide);
    updateCastlingRights(next, move, piece, null);
    next.enPassant = null;
    return next;
  }

  const captured = pieceAt(next.board, move.to);
  const fromFile = fileOf(move.from);
  const toFile = fileOf(move.to);
  const isPawn = piece.type === "p";

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
 * Place the king and castling rook on their destinations (FIDE rule: king g/c, rook
 * f/d), reading the castling rook's start from this game's home files. Both origins
 * are cleared before placement so a Chess960 overlap (e.g. the king ending on the
 * rook's old square) can't drop a piece.
 */
function applyCastle(next: GameState, move: Move, king: Piece, side: "K" | "Q"): void {
  const rank = rankOf(move.from);
  const home = homeFiles(next);
  const rookFromSq = squareIndex(side === "K" ? home.hRook : home.aRook, rank);
  const rook = pieceAt(next.board, rookFromSq);
  next.board[move.from] = null;
  next.board[rookFromSq] = null;
  next.board[squareIndex(side === "K" ? 6 : 2, rank)] = king;
  next.board[squareIndex(side === "K" ? 5 : 3, rank)] = rook;
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

  // Castling first: in Chess960 `move.to` is the rook's square, which would otherwise
  // read as a (self-)capture. Detection is the single castleSideOf point.
  const castle = castleSideOf(pre, move, piece);
  if (castle) {
    return { kind: "move", color: piece.color, piece: piece.type, from: move.from, to: move.to, castle };
  }

  const fromFile = fileOf(move.from);
  const toFile = fileOf(move.to);
  const isPawn = piece.type === "p";

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
  // A rook leaving its home file (or being captured there) forfeits that side. Home
  // files come from the setup (classical a/h ⇒ the same corners as before).
  const home = homeFiles(state);
  const forfeit = (sq: SquareIndex) => {
    const f = fileOf(sq);
    const r = rankOf(sq);
    if (r === 0 && f === home.aRook) c.wQ = false;
    else if (r === 0 && f === home.hRook) c.wK = false;
    else if (r === 7 && f === home.aRook) c.bQ = false;
    else if (r === 7 && f === home.hRook) c.bK = false;
  };
  if (piece.type === "r") forfeit(move.from);
  if (captured && captured.type === "r") forfeit(move.to);
}
