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

import { cloneState, fileOf, onBoard, pieceAt, rankOf, squareIndex } from "./board.js";
import { applyMove, deriveMoveEvent, isLegalMove } from "./moves.js";
import { kingSafe } from "./phase.js";
import { registerMechanic, type Mechanic } from "./mechanic.js";
import type {
  Action,
  BoostInput,
  BoostState,
  Color,
  FairyBase,
  GameEvent,
  GameState,
  Move,
  Piece,
  PieceType,
  SquareIndex,
} from "./types.js";

// --- economy ----------------------------------------------------------------
/** Points to boost a piece by its base type. */
const BOOST_COST: Record<FairyBase, number> = { n: 1, b: 1, r: 3, q: 5, k: 8 };
/** Classical value of a sacrificed fodder piece (a king can never be fodder). */
const FODDER_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity };
/** Extra cost to boost AND move the same turn (an immediate boost). */
const IMMEDIATE_PREMIUM = 2;
/** A boost stands for this many of the owner's turns. */
const BUFF_TURNS = 3;

/** Total points the fodder must sum to (exact — no change, no banking). */
function boostCost(base: FairyBase, immediate: boolean): number {
  return BOOST_COST[base] + (immediate ? IMMEDIATE_PREMIUM : 0);
}

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

// --- validation + application -----------------------------------------------

export interface BoostCheck {
  ok: boolean;
  reason?: string;
}

/** Validate a boost for the side to move without mutating state. */
export function validateBoost(state: GameState, input: BoostInput): BoostCheck {
  if (state.status !== "active") return { ok: false, reason: "game is over" };
  const target = pieceAt(state.board, input.target);
  if (!target) return { ok: false, reason: "no piece to boost" };
  if (target.color !== state.turn) return { ok: false, reason: "not your piece" };
  if (target.type === "p") return { ok: false, reason: "pawns cannot be boosted" };
  if (boostAt(state, input.target, target.color)) {
    return { ok: false, reason: "that piece is already boosted" };
  }

  // Fodder: distinct own non-king pieces, not the target itself.
  const seen = new Set<SquareIndex>();
  let paid = 0;
  for (const sq of input.fodder) {
    if (sq === input.target) return { ok: false, reason: "the boosted piece cannot be its own fodder" };
    if (seen.has(sq)) return { ok: false, reason: "duplicate fodder square" };
    seen.add(sq);
    const fp = pieceAt(state.board, sq);
    if (!fp || fp.color !== target.color) return { ok: false, reason: "fodder must be your own piece" };
    if (fp.type === "k") return { ok: false, reason: "the king cannot be sacrificed" };
    paid += FODDER_VALUE[fp.type];
  }

  const base = target.type as FairyBase;
  const immediate = input.move !== undefined;
  const cost = boostCost(base, immediate);
  // No change, no banking: the fodder must sum EXACTLY to the cost.
  if (paid !== cost) {
    return { ok: false, reason: `fodder must total exactly ${cost} (got ${paid}); no change, no banking` };
  }

  // Apply on a probe and require the mover's king to be safe afterwards. For an
  // immediate boost the move must be legal for the now-boosted piece (and resolve any
  // check). For a standing boost the piece does not move, so it can't be played while
  // in check (it would end the turn in check) — same gate as a phase-out.
  const probe = applyBoostMechanics(state, input);
  if (!probe.ok) return { ok: false, reason: probe.reason };
  if (!kingSafe(probe.state, target.color)) {
    return { ok: false, reason: "after the boost your king would be in check" };
  }
  return { ok: true };
}

/**
 * Apply a boost's board mechanics on a fresh clone: remove the fodder (recorded as the
 * owner's own losses), add the standing boost, and — for an immediate boost — play the
 * move with the buff active. Returns ok:false if the immediate move is illegal. Does
 * NOT flip the turn or tick timers (game.ts orchestrates that). Validation-internal.
 */
function applyBoostMechanics(
  state: GameState,
  input: BoostInput,
): { ok: true; state: GameState } | { ok: false; reason: string } {
  const target = pieceAt(state.board, input.target)!;
  const base = target.type as FairyBase;
  let next = cloneState(state);
  const fodderTypes = input.fodder.map((sq) => pieceAt(next.board, sq)!.type);
  for (const sq of input.fodder) next.board[sq] = null;
  for (const t of fodderTypes) next.captured[target.color].push(t);
  const expiresOn = next.turnsTaken[target.color] + 1 + BUFF_TURNS;
  (next.boosts ??= []).push({ color: target.color, square: input.target, base, expiresOn });

  if (input.move) {
    if (input.move.from !== input.target) {
      return { ok: false, reason: "an immediate boost must move the boosted piece" };
    }
    if (!isLegalMove(next, input.move)) {
      return { ok: false, reason: "the immediate move is not legal for the boosted piece" };
    }
    next = applyMove(next, input.move);
    relocateBoosts(next, input.move); // carry the buff to the piece's new square
  }
  return { ok: true, state: next };
}

/** Carry boosts across a move: drop a CAPTURED enemy boost on the destination, then
 *  move the mover's boost from→to. Shared by the immediate-move path and the afterMove
 *  hook. Only an enemy boost on `to` is dropped — the mover's own boost there (e.g. one
 *  just granted by a promotion mechanic) is preserved. */
function relocateBoosts(state: GameState, move: Move): void {
  if (!state.boosts || state.boosts.length === 0) return;
  const moverColor = state.board[move.to]?.color;
  state.boosts = state.boosts.filter((b) => !(b.square === move.to && b.color !== moverColor));
  for (const b of state.boosts) if (b.square === move.from) b.square = move.to;
}

/** Exact-subset fodder selection (no change, no banking): own non-king pieces whose
 *  classical values sum to `cost`, or null if impossible. Prefers fewer pieces. */
function findFodder(state: GameState, color: Color, cost: number, exclude: SquareIndex): SquareIndex[] | null {
  const cands: { sq: SquareIndex; val: number }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (p && p.color === color && p.type !== "k" && sq !== exclude) cands.push({ sq, val: FODDER_VALUE[p.type] });
  }
  cands.sort((a, b) => b.val - a.val); // big-first ⇒ fewest pieces
  const picked: SquareIndex[] = [];
  const dfs = (i: number, remaining: number): boolean => {
    if (remaining === 0) return true;
    if (i >= cands.length || remaining < 0) return false;
    if (cands[i]!.val <= remaining) {
      picked.push(cands[i]!.sq);
      if (dfs(i + 1, remaining - cands[i]!.val)) return true;
      picked.pop();
    }
    return dfs(i + 1, remaining);
  };
  return dfs(0, cost) ? [...picked] : null;
}

/**
 * Legal standing (non-immediate) boosts for the side to move: one per boostable piece
 * for which an exact-cost fodder set exists and the resulting position is king-safe.
 * Immediate boosts are validated on demand but NOT enumerated here — the cross product
 * with the boosted piece's moves is left to callers that want it (e.g. a one-shot
 * search), keeping the per-node action list tractable for the bot.
 */
export function legalBoosts(state: GameState): BoostInput[] {
  if (state.status !== "active") return [];
  const out: BoostInput[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = pieceAt(state.board, sq);
    if (!p || p.color !== state.turn || p.type === "p" || p.type === "k") continue;
    if (boostAt(state, sq, p.color)) continue;
    const fodder = findFodder(state, p.color, BOOST_COST[p.type as FairyBase], sq);
    if (!fodder) continue;
    const input: BoostInput = { target: sq, fodder };
    if (validateBoost(state, input).ok) out.push(input);
  }
  return out;
}

/** Boost as a Mechanic (plugin #2) — movement fold, economy, expiry, notation. */
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

  legalActions(state) {
    return legalBoosts(state).map((boost) => ({ kind: "boost", boost }));
  },

  ownsAction(action) {
    return action.kind === "boost";
  },

  applyAction(state, action: Action) {
    if (action.kind !== "boost") throw new Error("boost.applyAction: not a boost");
    const check = validateBoost(state, action.boost);
    if (!check.ok) throw new Error(`illegal boost: ${check.reason}`);
    const input = action.boost;
    const target = pieceAt(state.board, input.target)!;
    const base = target.type as FairyBase;
    const fodderTypes = input.fodder.map((sq) => pieceAt(state.board, sq)!.type);
    const expiresOn = state.turnsTaken[target.color] + 1 + BUFF_TURNS;

    const applied = applyBoostMechanics(state, input);
    if (!applied.ok) throw new Error(`illegal boost: ${applied.reason}`);

    const events: GameEvent[] = [
      {
        kind: "boostGranted",
        color: target.color,
        base,
        square: input.target,
        fodder: fodderTypes,
        expiresOn,
        ...(input.move ? { immediate: true as const } : {}),
      },
    ];
    // The immediate move's event is derived from the post-boost / pre-move position.
    if (input.move) {
      const preMove = cloneState(state);
      for (const sq of input.fodder) preMove.board[sq] = null;
      events.push(deriveMoveEvent(preMove, input.move));
    }
    return { state: applied.state, events };
  },

  afterMove(state, move) {
    relocateBoosts(state, move);
  },

  onTurnEnd(state, mover) {
    if (!state.boosts || state.boosts.length === 0) return { state, events: [] };
    const next = cloneState(state);
    const events: GameEvent[] = [];
    next.boosts = next.boosts!.filter((b) => {
      // Defensive prune: a boosted piece captured (incl. by a phase-in) leaves a stale
      // entry — drop it when the square no longer holds the matching piece.
      const pc = pieceAt(next.board, b.square);
      if (!pc || pc.color !== b.color || pc.type !== b.base) return false;
      // Timer expiry — only the mover's clock advanced this turn.
      if (b.color === mover && next.turnsTaken[mover] >= b.expiresOn) {
        events.push({ kind: "boostExpired", color: b.color, base: b.base, square: b.square });
        return false;
      }
      return true;
    });
    return { state: next, events };
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

  renderEvent(event) {
    if (event.kind === "boostGranted") {
      const FAIRY: Record<FairyBase, string> = { b: "DH", n: "NF", r: "DK", q: "AM", k: "K2" };
      const at = `${"abcdefgh"[fileOf(event.square)]}${rankOf(event.square) + 1}`;
      const fodder = event.fodder.map((t) => t.toUpperCase()).join("");
      return `+${FAIRY[event.base]}@${at}[${fodder}]${event.immediate ? "!" : ""}`;
    }
    if (event.kind === "boostExpired") {
      const at = `${"abcdefgh"[fileOf(event.square)]}${rankOf(event.square) + 1}`;
      return `-boost@${at}`;
    }
    return null;
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
