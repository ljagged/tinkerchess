// PERF GATE (plan Stage 1, decision 2 / finding 2). The determinism golden locks
// the exact NODE COUNT a fixed-depth search visits — so any change to search shape
// fails there. This file guards the other half: per-node SPEED. Production play uses
// the time-budget path, where a slower-per-node engine reaches a shallower depth and
// plays a weaker move with every behavior test still green. A registry fold that
// added work to the hot path (isAttacked / applyAction / evaluate) would show up as a
// nodes/sec drop here.
//
// nodes/sec is hardware-dependent (and lower under the vitest runner than standalone),
// so the floor is deliberately generous — it catches a gross per-node regression (e.g.
// an ungated fold on the hot path), not a few percent. The exact NODE COUNT below is
// the strong, machine-independent lock; the nps floor is a coarse speed guard. The
// measured value is logged so a soft drift is visible in CI output even when it passes.

import { describe, it, expect } from "vitest";
import { createGame, applyAction } from "../engine/index.js";
import type { GameState } from "../engine/index.js";
import { legalActions, mulberry32 } from "../engine/_testgames.js";
import { search } from "./search.js";

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

const NODES_FLOOR_NPS = 5000;

describe("bot perf gate (Stage 1)", () => {
  it("visits the exact baseline node total and clears the nodes/sec floor", () => {
    const states = [createGame(), randomState(13, 20), randomState(99, 14)];
    for (const s of states) search(s, { maxDepth: 3 }); // warm up the JIT

    const start = performance.now();
    let nodes = 0;
    for (const s of states) nodes += search(s, { maxDepth: 3 }).nodes;
    const ms = performance.now() - start;
    const nps = Math.round(nodes / (ms / 1000));

    // eslint-disable-next-line no-console
    console.log(`[perf gate] nodes=${nodes} ms=${ms.toFixed(0)} nps=${nps}`);

    // Behavior lock: this total is fully deterministic and must not move.
    expect(nodes).toBe(43325);
    // Perf guard: generous floor, hardware-independent enough to not flake.
    expect(nps).toBeGreaterThan(NODES_FLOOR_NPS);
  });
});
