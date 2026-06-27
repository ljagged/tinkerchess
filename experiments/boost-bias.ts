// Experiment — does boost amplify White's first-move advantage?
//
// External-review claim (Gemini, "Failure Mode 1"): boost turns White's ~52–56%
// classical edge into a near-forced win. This measures it directly.
//
// METHOD: the SAME engine (fixed-depth search) plays both sides, over a SHARED set of
// seeded-random openings, under two rulesets — baseline ["phasing"] and boost
// ["phasing","boost"]. Each opening is a few random CLASSICAL plies, so both conditions
// start from byte-identical boards; only boost-availability during the play-out differs.
// Report White's score% = (wins + ½·draws)/games for each ruleset. Because the opening
// set is identical for both, opening imbalance cancels in the DELTA — the boost−baseline
// difference is the signal (does adding boost move White's score up or down?).
//
// HONEST LIMITS (read before quoting a number):
//   1. A fixed-depth bot is FAR weaker than the engines behind the book 52–56% figure,
//      so the ABSOLUTE White% here won't match book values. The valid read is the
//      DELTA between baseline and boost under one engine: does boost widen the edge?
//   2. Full-information self-play — phasing's fog is not modelled (both sides see all).
//      This measures rules-level balance, not the fog game a human plays.
//   3. Modest game counts at shallow depth ⇒ wide error bars; treat as a first baseline,
//      widen GAMES/DEPTH to tighten. Tunables: GAMES, DEPTH, OPENING_PLIES, MAX_PLIES, SEED.

import {
  applyActionWithEvents,
  cloneState,
  createGame,
  legalMoves,
  type Color,
  type GameEvent,
  type GameState,
} from "../src/engine/index.js";
import { search } from "../src/bot/index.js"; // via index ⇒ boost eval term registered
import { table } from "./lib/report.js";

const GAMES = Number(process.env.GAMES ?? 40);
const DEPTH = Number(process.env.DEPTH ?? 3);
const OPENING_PLIES = Number(process.env.OPENING_PLIES ?? 8);
const MAX_PLIES = Number(process.env.MAX_PLIES ?? 160);
const NO_PROGRESS = Number(process.env.NO_PROGRESS ?? 80);
const SEED = Number(process.env.SEED ?? 1);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A capture or pawn move is "progress" (TC has no fifty-move rule; weak play shuffles). */
const isProgress = (events: GameEvent[]): boolean =>
  events.some((e) => ("capture" in e && e.capture) || (e.kind === "move" && e.piece === "p"));

/** A diversified opening: `plies` random CLASSICAL moves (no boosts/phase-outs), so the
 *  board is shareable across rulesets. Returns null if the random game ended early. */
function randomOpening(rand: () => number, plies: number): GameState | null {
  let state = createGame();
  for (let i = 0; i < plies; i++) {
    const moves = legalMoves(state);
    if (moves.length === 0) return null;
    state = applyActionWithEvents(state, { kind: "move", move: moves[Math.floor(rand() * moves.length)]! }).state;
    if (state.status !== "active") return null;
  }
  return state;
}

type Outcome = "w" | "b" | "draw";

/** Play `start` to a result with the fixed-depth bot on both sides under `mechanics`. */
function playOut(start: GameState, mechanics: string[]): Outcome {
  let state = cloneState(start);
  state.mechanics = mechanics.slice();
  let sinceProgress = 0;
  for (let plies = 0; state.status === "active"; plies++) {
    if (plies >= MAX_PLIES || sinceProgress >= NO_PROGRESS) return "draw";
    const action = search(state, { maxDepth: DEPTH }).action;
    const { state: next, events } = applyActionWithEvents(state, action);
    sinceProgress = isProgress(events) ? 0 : sinceProgress + 1;
    state = next;
  }
  return state.status === "w_won" ? "w" : state.status === "b_won" ? "b" : "draw";
}

interface Tally {
  w: number;
  b: number;
  draw: number;
}
const add = (t: Tally, o: Outcome) => (o === "w" ? t.w++ : o === "b" ? t.b++ : t.draw++);
const whiteScore = (t: Tally): number => {
  const n = t.w + t.b + t.draw;
  return n ? (t.w + 0.5 * t.draw) / n : 0;
};

function run() {
  const rand = mulberry32(SEED);
  const baseline: Tally = { w: 0, b: 0, draw: 0 };
  const boost: Tally = { w: 0, b: 0, draw: 0 };
  let played = 0;
  let attempts = 0;
  while (played < GAMES && attempts < GAMES * 5) {
    attempts++;
    const opening = randomOpening(rand, OPENING_PLIES);
    if (!opening) continue; // opening fizzled — draw a fresh one
    add(baseline, playOut(opening, ["phasing"]));
    add(boost, playOut(opening, ["phasing", "boost"]));
    played++;
  }
  return { baseline, boost, played };
}

const t0 = performance.now();
const { baseline, boost, played } = run();
const secs = ((performance.now() - t0) / 1000).toFixed(0);

const pctRow = (label: string, t: Tally) => [
  label,
  String(t.w),
  String(t.b),
  String(t.draw),
  `${(100 * whiteScore(t)).toFixed(1)}%`,
];

// eslint-disable-next-line no-console
console.log(
  `boost bias — ${played} shared openings, depth ${DEPTH}, ${OPENING_PLIES} opening plies, seed ${SEED} (${secs}s)\n` +
    `same engine both sides; identical opening boards per row so opening imbalance cancels in the delta\n`,
);
console.log(
  table(
    ["ruleset", "W wins", "B wins", "draws", "White score%"],
    [pctRow("baseline  [phasing]", baseline), pctRow("boost     [phasing,boost]", boost)],
  ),
);

const delta = 100 * (whiteScore(boost) - whiteScore(baseline));
console.log(
  `\nWhite-score DELTA (boost − baseline): ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts\n` +
    (Math.abs(delta) < 5
      ? "→ within noise at this sample/depth: no evidence boost amplifies White's edge. (Widen GAMES/DEPTH to tighten.)"
      : delta > 0
        ? "→ boost moved White's score UP — consistent with amplifying the first-move edge. Confirm with more games before trusting."
        : "→ boost moved White's score DOWN — if anything it dampens the first-move edge here."),
);
console.log(
  "\nLIMITS: fixed-depth bot (absolute % ≠ book values; read the DELTA), full-information" +
    " (no fog), modest sample. A first baseline, not a verdict.",
);
