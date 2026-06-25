// Negamax alpha-beta search with iterative deepening.
//
// Deterministic given (state, depth): the candidate-action order is fixed by the
// engine, move ordering is a stable sort, and nothing here calls Math.random.
// Terminality is read from the engine's `status`/`endReason` after applyAction —
// NEVER from the bot's own "do I have an action?" check — so the search inherits
// the variant's signature corner for free: a side whose only action is a phase-out
// is still checkmated/stalemated (RULES.md §7.2, engine adjudicate uses legalMoves
// only).
//
// Two budget modes (both live here, not in the pure engine):
//   - fixed depth   (opts.maxDepth)     — reproducible; used by the test suite.
//   - time budget   (opts.timeBudgetMs) — iterative deepening until the clock runs
//                                          out, keeping the last completed depth.

import {
  applyAction,
  kingSafe,
  legalMoves,
  legalPhaseOuts,
  pieceAt,
  positionKey,
} from "../engine/index.js";
import type { Action, GameState } from "../engine/index.js";
import { DEFAULT_WEIGHTS, evaluate, type EvalWeights } from "./evaluate.js";

const MATE = 1_000_000;
const QUIESCE_PLY_CAP = 16;

export interface SearchOptions {
  /** Fixed-depth mode: search exactly this many plies. Deterministic. */
  maxDepth?: number;
  /** Time-budget mode: iterative deepening until this many ms elapse. */
  timeBudgetMs?: number;
  /** Injectable clock (default Date.now). The bot may use a clock; the engine may not. */
  now?: () => number;
  weights?: EvalWeights;
}

export interface SearchResult {
  action: Action;
  score: number;
  /** Depth actually completed. */
  depth: number;
  nodes: number;
}

interface TTEntry {
  depth: number;
  score: number;
  flag: "exact" | "lower" | "upper";
}

interface Ctx {
  weights: EvalWeights;
  deadline: number;
  now: () => number;
  tt: Map<string, TTEntry>;
  nodes: number;
}

class SearchTimeout extends Error {}

/**
 * Transposition key: the repetition key (visible board + turn + castling + ep) PLUS
 * a digest of the phased state. positionKey alone is the REPETITION key and is lossy
 * for search — two positions with the same board but different pending returns are
 * NOT search-equivalent (their futures differ), so reusing bounds across them would
 * corrupt the table (review finding F2).
 */
export function ttKey(state: GameState): string {
  const phased = state.phased
    .map((p) => `${p.color}${p.type}${p.origin}:${p.returnOn}`)
    .sort()
    .join(",");
  return `${positionKey(state)}#${phased}`;
}

function candidateActions(state: GameState): Action[] {
  const actions: Action[] = [];
  for (const move of legalMoves(state)) actions.push({ kind: "move", move });
  for (const phaseOut of legalPhaseOuts(state)) actions.push({ kind: "phaseOut", phaseOut });
  return actions;
}

const PV = DEFAULT_WEIGHTS.pieceValue;

/** Move-ordering score (higher first). Phase-outs sort last; captures by MVV-LVA. */
function orderScore(state: GameState, action: Action): number {
  if (action.kind === "phaseOut") return -1_000_000; // most phase-outs are bad; prune late
  const m = action.move;
  const victim = pieceAt(state.board, m.to);
  const mover = pieceAt(state.board, m.from)!;
  if (victim) return 100_000 + 10 * PV[victim.type] - PV[mover.type];
  if (mover.type === "p" && m.to === state.enPassant) return 100_000; // en-passant capture
  return 0; // quiet
}

function orderedActions(state: GameState): Action[] {
  return candidateActions(state)
    .map((action, i) => ({ action, i, score: orderScore(state, action) }))
    .sort((a, b) => b.score - a.score || a.i - b.i) // stable: ties keep engine order
    .map((x) => x.action);
}

/** A capture is a forcing move worth searching in quiescence. */
function isCapture(state: GameState, action: Action): boolean {
  if (action.kind !== "move") return false;
  const m = action.move;
  if (pieceAt(state.board, m.to)) return true;
  const mover = pieceAt(state.board, m.from);
  return mover?.type === "p" && m.to === state.enPassant;
}

/** Score a terminal node from the side-to-move's perspective. */
function terminalScore(state: GameState, ply: number): number {
  // The losing side is the side to move at a checkmate node (adjudicate flips turn
  // before setting status). Prefer faster mates / slower losses via the ply offset.
  if (state.endReason === "checkmate") return -(MATE - ply);
  return 0; // stalemate / repetition draw
}

function checkDeadline(ctx: Ctx): void {
  if (ctx.now() >= ctx.deadline) throw new SearchTimeout();
}

function quiesce(state: GameState, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  ctx.nodes++;
  if (state.status !== "active") return terminalScore(state, ply);

  let best = evaluate(state, state.turn, ctx.weights); // stand-pat
  if (best >= beta) return best;
  if (best > alpha) alpha = best;
  if (ply >= QUIESCE_PLY_CAP) return best;

  for (const action of orderedActions(state)) {
    if (!isCapture(state, action)) continue;
    const score = -quiesce(applyAction(state, action), -beta, -alpha, ply + 1, ctx);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // cutoff
  }
  return best;
}

function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Ctx,
): number {
  ctx.nodes++;
  if (state.status !== "active") return terminalScore(state, ply);

  // Check extension: a forced reply line is searched one ply deeper.
  const inCheck = !kingSafe(state, state.turn);
  const d = inCheck ? depth + 1 : depth;
  if (d <= 0) return quiesce(state, alpha, beta, ply, ctx);

  checkDeadline(ctx);

  const key = ttKey(state);
  const hit = ctx.tt.get(key);
  if (hit && hit.depth >= d) {
    if (hit.flag === "exact") return hit.score;
    if (hit.flag === "lower" && hit.score > alpha) alpha = hit.score;
    else if (hit.flag === "upper" && hit.score < beta) beta = hit.score;
    if (alpha >= beta) return hit.score;
  }

  const origAlpha = alpha;
  let best = -Infinity;
  for (const action of orderedActions(state)) {
    const score = -negamax(applyAction(state, action), d - 1, -beta, -alpha, ply + 1, ctx);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }

  const flag = best <= origAlpha ? "upper" : best >= beta ? "lower" : "exact";
  ctx.tt.set(key, { depth: d, score: best, flag });
  return best;
}

/** Root: search every candidate action to `depth` and return the best, with its score. */
function searchRoot(
  state: GameState,
  depth: number,
  ctx: Ctx,
): { action: Action; score: number } {
  let bestAction: Action | null = null;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const action of orderedActions(state)) {
    const score = -negamax(applyAction(state, action), depth - 1, -beta, -alpha, 1, ctx);
    if (bestAction === null || score > alpha) {
      alpha = score;
      bestAction = action;
    }
  }
  if (bestAction === null) throw new Error("search called on a position with no legal actions");
  return { action: bestAction, score: alpha };
}

/**
 * Choose the best action for the side to move. With `maxDepth`, runs a single fixed
 * depth (deterministic). With `timeBudgetMs`, iteratively deepens until the budget
 * is spent, returning the deepest fully-completed result.
 */
export function search(state: GameState, opts: SearchOptions = {}): SearchResult {
  const now = opts.now ?? (() => Date.now());
  const ctx: Ctx = {
    weights: opts.weights ?? DEFAULT_WEIGHTS,
    deadline: opts.timeBudgetMs === undefined ? Infinity : now() + opts.timeBudgetMs,
    now,
    tt: new Map(),
    nodes: 0,
  };

  if (opts.maxDepth !== undefined) {
    const { action, score } = searchRoot(state, opts.maxDepth, ctx);
    return { action, score, depth: opts.maxDepth, nodes: ctx.nodes };
  }

  // Iterative deepening under a time budget. Keep the last completed depth.
  let result = searchRoot(state, 1, ctx);
  let depth = 1;
  for (let d = 2; ; d++) {
    try {
      result = searchRoot(state, d, ctx);
      depth = d;
    } catch (e) {
      if (e instanceof SearchTimeout) break;
      throw e;
    }
    if (Math.abs(result.score) >= MATE - 1000) break; // forced mate found
    if (now() >= ctx.deadline) break;
  }
  return { ...result, depth, nodes: ctx.nodes };
}

/** The bot's full action choice for a reconstructed state. */
export function chooseActionFromState(state: GameState, opts: SearchOptions = {}): Action {
  return search(state, opts).action;
}
