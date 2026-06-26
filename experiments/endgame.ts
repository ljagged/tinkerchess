// Experiment B — Endgame power probe.
//
// A full-width win/draw/loss solver (alpha-beta, optimal defense, mate = win,
// horizon = draw) run over curated material configs, once with phasing enabled for
// the attacker and once classical. A draw→win flip is direct evidence that phasing
// expands what's winnable. KQ-vs-K is a positive control (the solver must find that
// classical mate). Insufficient-material configs (KN, KB, KNN vs K) test whether
// phasing rescues a classical draw within the search horizon.
//
// HONEST LIMIT: this proves "forced mate within DEPTH plies", not general winnability
// (that needs a TC-aware retrograde tablebase — out of scope). Tunable: DEPTH (plies).
import {
  applyAction,
  createGame,
  legalMoves,
  legalPhaseOuts,
  parseSquare,
  positionKey,
} from "../src/engine/index.js";
import type { Action, Color, GameState, Piece, PieceType, RuleConfig } from "../src/engine/index.js";
import { table } from "./lib/report.js";

const DEPTH = Number(process.env.DEPTH ?? 7);
const MATE = 1_000_000;

const PIECE_TYPES: PieceType[] = ["p", "n", "b", "r", "q", "k"];
const classical: RuleConfig = {
  maxPhaseDuration: Object.fromEntries(PIECE_TYPES.map((t) => [t, 0])) as Record<PieceType, number>,
};
// Phasing on, king non-phaseable, durations capped at 1: keeps branching tractable
// for a full-width search (drawn positions have no alpha-beta cutoffs, so the tree
// is exponential in depth — this is a shallow-horizon probe, not a winnability proof).
const phasing: RuleConfig = {
  maxPhaseDuration: { p: 0, n: 1, b: 1, r: 1, q: 1, k: 0 },
};

type Placement = [square: string, color: Color, type: PieceType];

function position(pieces: Placement[], turn: Color, config: RuleConfig): GameState {
  const base = createGame(config);
  const board: (Piece | null)[] = Array(64).fill(null);
  for (const [sq, color, type] of pieces) board[parseSquare(sq)] = { color, type };
  const s: GameState = {
    ...base,
    board,
    turn,
    status: "active",
    endReason: undefined,
    lastEvent: null,
    phased: [],
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    enPassant: null,
    turnsTaken: { w: 0, b: 0 },
    captured: { w: [], b: [] },
    history: [],
  };
  s.history = [positionKey(s)];
  return s;
}

function actions(state: GameState): Action[] {
  const out: Action[] = [];
  for (const m of legalMoves(state)) out.push({ kind: "move", move: m });
  for (const p of legalPhaseOuts(state)) out.push({ kind: "phaseOut", phaseOut: p });
  return out;
}

/** Negamax to a fixed horizon: mate = ±(MATE−ply), draw/horizon = 0. Returns the
 *  side-to-move value. A root value ≥ MATE−DEPTH means a forced mate within DEPTH plies. */
function solve(state: GameState, depth: number, ply: number, alpha: number, beta: number): number {
  if (state.status !== "active") {
    return state.endReason === "checkmate" ? -(MATE - ply) : 0;
  }
  if (depth === 0) return 0;
  let best = -Infinity;
  for (const action of actions(state)) {
    const score = -solve(applyAction(state, action), depth - 1, ply + 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

interface Probe {
  name: string;
  pieces: Placement[]; // White = attacker, to move
  note: string;
}
const PROBES: Probe[] = [
  { name: "KQ v K (control)", pieces: [["c6", "w", "k"], ["b6", "w", "q"], ["a8", "b", "k"]], note: "classically WON" },
  { name: "KN v K", pieces: [["c6", "w", "k"], ["c5", "w", "n"], ["a8", "b", "k"]], note: "classically DRAWN (insufficient)" },
  { name: "KB v K", pieces: [["c6", "w", "k"], ["c5", "w", "b"], ["a8", "b", "k"]], note: "classically DRAWN (insufficient)" },
];

function classify(pieces: Placement[], config: RuleConfig): string {
  const root = position(pieces, "w", config);
  const score = solve(root, DEPTH, 0, -Infinity, Infinity);
  if (score >= MATE - DEPTH) return `mate in ${MATE - score}`;
  return "no mate";
}

const header = ["config", "classical", "phasing", "flip?", "note"];
const rows: string[][] = [];
console.log(`Endgame power probe — full-width solver to ${DEPTH} plies (White to move, optimal defense)\n`);
for (const p of PROBES) {
  const c = classify(p.pieces, classical);
  const ph = classify(p.pieces, phasing);
  const flip = c === "no mate" && ph !== "no mate" ? "DRAW→WIN" : "";
  rows.push([p.name, c, ph, flip, p.note]);
  console.log("  done:", p.name);
}
console.log("\n" + table(header, rows) + "\n");
console.log("flip = phasing forces a mate the classical search can't (within the horizon).");
