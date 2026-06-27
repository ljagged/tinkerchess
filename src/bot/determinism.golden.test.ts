// REGRESSION GATE (plan Stage 1, decision 2): the bot is deterministic given
// (state, fixed depth), and the moddable-engine refactor must preserve that
// behavior EXACTLY — same chosen action, same score, AND the same node count.
//
// Why node count, not just the action: production play uses the time-budget
// iterative-deepening path, where a change in nodes/sec silently changes the depth
// reached and therefore the move — with every other test still green (review
// finding 2). Locking the exact node count at a fixed depth makes any search-shape
// drift (candidate order, TT keying, eval summation order) fail loudly here.
//
// These golden values were captured from the pre-registry engine. If a change is a
// genuine, intended behavior change (not the Stage-1 behavior-preserving refactor),
// re-capture them deliberately — never edit a single number to make a red test pass.

import { describe, it, expect } from "vitest";
import { createGame, applyAction, initialState } from "../engine/index.js";
import type { GameState } from "../engine/index.js";
import { legalActions, mulberry32 } from "../engine/_testgames.js";
import { search } from "./search.js";

/** Reconstruct a position by playing `plies` seeded-random legal actions. Mirrors
 *  the capture harness exactly (moves-then-phaseOuts order, same PRNG draw). */
function randomState(seed: number, plies: number): GameState {
  const rand = mulberry32(seed);
  let state = createGame();
  for (let ply = 0; ply < plies && state.status === "active"; ply++) {
    const opts = legalActions(state);
    if (opts.length === 0) break;
    state = applyAction(state, opts[Math.floor(rand() * opts.length)]!);
  }
  return state;
}

interface Golden {
  name: string;
  action: unknown;
  score: number;
  nodes: number;
}

// Captured from the baseline engine at maxDepth 3. 24 of these positions carry
// phased pieces (see the trailing counts in the capture), so the ring term, the
// phased material discount, and the ttKey phased digest are all under the lock.
const GOLDEN: Golden[] = [
  { name: "initial-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 36, nodes: 4503 },
  { name: "seed1-p8-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: -22.666666666666686, nodes: 4623 },
  { name: "seed1-p14-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 984, nodes: 7107 },
  { name: "seed1-p20-d3", action: { kind: "move", move: { from: 28, to: 37 } }, score: 1028, nodes: 6590 },
  { name: "seed7-p8-d3", action: { kind: "move", move: { from: 12, to: 28 } }, score: 88, nodes: 17781 },
  { name: "seed7-p14-d3", action: { kind: "move", move: { from: 12, to: 28 } }, score: -378, nodes: 12640 },
  { name: "seed7-p20-d3", action: { kind: "move", move: { from: 5, to: 40 } }, score: 262, nodes: 9347 },
  { name: "seed13-p8-d3", action: { kind: "move", move: { from: 11, to: 27 } }, score: 12, nodes: 20074 },
  { name: "seed13-p14-d3", action: { kind: "move", move: { from: 16, to: 33 } }, score: 130, nodes: 6367 },
  { name: "seed13-p20-d3", action: { kind: "move", move: { from: 12, to: 28 } }, score: 256, nodes: 19947 },
  { name: "seed42-p8-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 154.66666666666669, nodes: 7639 },
  { name: "seed42-p14-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 46, nodes: 4468 },
  { name: "seed42-p20-d3", action: { kind: "move", move: { from: 1, to: 9 } }, score: 8, nodes: 4369 },
  { name: "seed99-p8-d3", action: { kind: "move", move: { from: 2, to: 20 } }, score: 68, nodes: 17152 },
  { name: "seed99-p14-d3", action: { kind: "move", move: { from: 6, to: 12 } }, score: 320, nodes: 18875 },
  { name: "seed99-p20-d3", action: { kind: "move", move: { from: 12, to: 22 } }, score: 112, nodes: 16990 },
  { name: "seed123-p8-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 30, nodes: 8753 },
  { name: "seed123-p14-d3", action: { kind: "move", move: { from: 15, to: 23 } }, score: 234.66666666666669, nodes: 26738 },
  { name: "seed123-p20-d3", action: { kind: "move", move: { from: 14, to: 49 } }, score: 88, nodes: 10046 },
  { name: "seed777-p8-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 400, nodes: 6558 },
  { name: "seed777-p14-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 296, nodes: 16759 },
  { name: "seed777-p20-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 494, nodes: 6617 },
  { name: "seed2024-p8-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 48, nodes: 7918 },
  { name: "seed2024-p14-d3", action: { kind: "move", move: { from: 1, to: 18 } }, score: 90, nodes: 12182 },
  { name: "seed2024-p20-d3", action: { kind: "move", move: { from: 18, to: 33 } }, score: 1030, nodes: 20557 },
];

/** Rebuild a golden case's starting state from its name (initial, or seedS-pP-d3). */
function stateFor(name: string): GameState {
  if (name === "initial-d3") return initialState();
  const m = /^seed(\d+)-p(\d+)-d3$/.exec(name);
  if (!m) throw new Error(`unrecognized golden case name: ${name}`);
  return randomState(Number(m[1]), Number(m[2]));
}

describe("bot determinism golden (Stage 1 regression gate)", () => {
  for (const g of GOLDEN) {
    it(`${g.name}: identical action, score, and node count at depth 3`, () => {
      const r = search(stateFor(g.name), { maxDepth: 3 });
      expect({ action: r.action, score: r.score, nodes: r.nodes }).toEqual({
        action: g.action,
        score: g.score,
        nodes: g.nodes,
      });
    });
  }
});
