// Determinism + replay guarantees (eng-review 0a spike).
//
// The engine is a pure, deterministic reducer with NO randomness in M1. These
// tests prove the property the whole history/replay/reveal feature rests on:
//   replay(initialState, actionSequence) === the live final state.
// A finished game can therefore be stored as { initialState, actions } and
// re-derived on demand, rather than as board snapshots.
//
// When randomness arrives with mods (M2), the same guarantee holds by injecting a
// server-owned seeded PRNG into the pure engine — never ambient Math.random, whose
// cross-boundary behavior we deliberately do not depend on.

import { describe, it, expect } from "vitest";
import { applyAction, createGame, replay } from "./index.js";
import type { Action } from "./index.js";
import { randomGame } from "./_testgames.js";

const finalOf = (seed: number, maxPlies?: number) => {
  const { actions, states } = randomGame(seed, maxPlies);
  return { actions, final: states[states.length - 1]! };
};

describe("determinism & replay", () => {
  it("replays a fixed sequence to an identical state", () => {
    // 1. e4 (Pe2->e4), then knight phases out for 2.
    const actions: Action[] = [
      { kind: "move", move: { from: 12, to: 28 } }, // e2->e4
      { kind: "move", move: { from: 52, to: 36 } }, // e7->e5
      { kind: "phaseOut", phaseOut: { from: 6, duration: 2 } }, // Ng1 phases out
    ];
    const a = replay(actions);
    const b = replay(actions);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Folding by hand matches replay().
    let manual = createGame();
    for (const act of actions) manual = applyAction(manual, act);
    expect(JSON.stringify(manual)).toBe(JSON.stringify(a));
  });

  it("replay(actions) reproduces the live final state across many random games", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { actions, final } = finalOf(seed);
      const replayed = replay(actions);
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
    }
  });

  it("applyAction does not mutate its input (purity)", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { actions } = randomGame(seed, 12);
      let state = createGame();
      for (const action of actions) {
        const before = JSON.stringify(state);
        const next = applyAction(state, action);
        expect(JSON.stringify(state)).toBe(before); // input untouched
        state = next;
      }
    }
  });

  it("the same seed yields the same game (generator is deterministic)", () => {
    expect(JSON.stringify(randomGame(42).actions)).toBe(JSON.stringify(randomGame(42).actions));
  });
});
