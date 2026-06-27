// PERF GATE (plan Stage 1, decision 2 / finding 2). The determinism golden locks
// the exact NODE COUNT a fixed-depth search visits — so any change to search shape
// fails there. This file guards the other half: per-node SPEED. Production play uses
// the time-budget path, where a slower-per-node engine reaches a shallower depth and
// plays a weaker move with every behavior test still green. A registry fold that
// added work to the hot path (isAttacked / applyAction / evaluate) would show up as a
// nodes/sec drop here.
//
// nodes/sec is hardware-dependent: a slow CI runner measured ~4.8k nps where this dev
// box sees ~12k, so an absolute floor sensitive enough to catch a 2x regression also
// flakes on slow hardware — the two goals conflict for an absolute gate. So the EXACT
// NODE COUNT is the hard, machine-independent gate (it locks search shape outright),
// and the nps check is only a CATASTROPHE backstop (a 5-10x blowup, e.g. an ungated
// fold or an accidental O(n) in the hot path). The measured nps is logged every run so
// a real per-node slowdown is still visible as a CI trend even though it won't fail the
// build at a few-percent level.

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

// Catastrophe backstop only (see header): ~4-5x below the slowest observed CI runner,
// so it never flakes on hardware variance but still trips on a gross blowup.
const NODES_FLOOR_NPS = 1000;

describe("bot perf gate (Stage 1)", () => {
  it("visits the exact baseline node total and clears the catastrophe nps floor", () => {
    const states = [createGame(), randomState(13, 20), randomState(99, 14)];
    for (const s of states) search(s, { maxDepth: 3 }); // warm up the JIT

    const start = performance.now();
    let nodes = 0;
    for (const s of states) nodes += search(s, { maxDepth: 3 }).nodes;
    const ms = performance.now() - start;
    const nps = Math.round(nodes / (ms / 1000));

    // eslint-disable-next-line no-console
    console.log(`[perf gate] nodes=${nodes} ms=${ms.toFixed(0)} nps=${nps}`);

    // Behavior lock: this total is fully deterministic and must not move (the real gate).
    expect(nodes).toBe(43325);
    // Catastrophe backstop only — hardware-independent enough to never flake in CI.
    expect(nps).toBeGreaterThan(NODES_FLOOR_NPS);
  });
});
