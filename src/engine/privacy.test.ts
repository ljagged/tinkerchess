// Fog-of-war privacy invariant (eng-review Issue 5).
//
// THE correctness property of the variant: viewFor (the single canonical fog
// filter) must never leak an opponent's hidden state. A leak silently breaks the
// whole game. Property-based over hundreds of random games, PLUS targeted cases.
//
// The privacy contract for a player viewer:
//   - yourPhased contains ONLY the viewer's own phased pieces (with timers).
//   - warningSquares contains ONLY origin squares of OPPONENT pieces returning at
//     the end of the opponent's NEXT turn (the one-turn warning), square-only.
//   - Nothing in the view reveals an opponent's phased piece identity, timer, or a
//     return square more than one turn out.
//   - The raw `phased` array is never serialized into the view.
// Spectators see neither (yourPhased and warningSquares both empty).
// (Self-captures surface via lastEvent and are INTENTIONALLY public to both — they
//  are not a privacy concern.)

import { describe, it, expect } from "vitest";
import { applyAction, createGame, opponent, viewFor } from "./index.js";
import type { Color, GameState } from "./index.js";
import { randomGame } from "./_testgames.js";

function checkInvariant(state: GameState): void {
  for (const viewer of ["w", "b", "spectator"] as const) {
    const view = viewFor(state, viewer);

    // The raw phased array is never exposed.
    expect((view as unknown as { phased?: unknown }).phased).toBeUndefined();

    if (viewer === "spectator") {
      expect(view.yourPhased).toEqual([]);
      expect(view.warningSquares).toEqual([]);
      continue;
    }

    const me = viewer as Color;
    const opp = opponent(me);
    const myPhased = state.phased.filter((p) => p.color === me);
    const oppPhased = state.phased.filter((p) => p.color === opp);

    // yourPhased: exactly my own phased pieces, never the opponent's.
    expect(view.yourPhased.length).toBe(myPhased.length);
    const myOrigins = new Set(myPhased.map((p) => p.origin));
    for (const vp of view.yourPhased) expect(myOrigins.has(vp.origin)).toBe(true);

    // warningSquares: exactly the opponent's pieces due at the end of their NEXT
    // turn (returnOn === opp's turnsTaken + 1). Square-only, identity-free.
    const expectedWarnings = oppPhased
      .filter((p) => p.returnOn === state.turnsTaken[opp] + 1)
      .map((p) => p.origin)
      .sort((a, b) => a - b);
    expect([...view.warningSquares].sort((a, b) => a - b)).toEqual(expectedWarnings);

    // No leak beyond the one-turn warning: an opponent piece returning later must
    // NOT have its origin exposed FOR ITS OWN SAKE. A square may legitimately be
    // exposed for another reason — an imminent opponent return there, or one of the
    // viewer's OWN phased pieces sharing that origin square (origins can coincide
    // transiently). Those are not leaks; only an otherwise-hidden square would be.
    const exposed = new Set<number>([...view.warningSquares, ...view.yourPhased.map((p) => p.origin)]);
    const legitimate = new Set<number>([...expectedWarnings, ...myOrigins]);
    for (const p of oppPhased) {
      if (p.returnOn > state.turnsTaken[opp] + 1 && !legitimate.has(p.origin)) {
        expect(exposed.has(p.origin)).toBe(false);
      }
    }
  }
}

describe("fog-of-war privacy invariant", () => {
  it("never leaks opponent hidden state across many random games", () => {
    let sawPhased = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const state of randomGame(seed).states) {
        if (state.phased.length > 0) sawPhased++;
        checkInvariant(state);
      }
    }
    // Sanity: the random games actually exercised the interesting (phased) path.
    expect(sawPhased).toBeGreaterThan(0);
  });

  it("targeted: a one-turn warning shows the square to the opponent, full timer to the owner", () => {
    // White phases the g1 knight (sq 6) for 1; it's now Black to move, and the
    // knight is due at the end of White's next turn -> a one-turn warning.
    const s = applyAction(createGame(), { kind: "phaseOut", phaseOut: { from: 6, duration: 1 } });

    const blackView = viewFor(s, "b"); // opponent: sees the square only
    expect(blackView.warningSquares).toEqual([6]);
    expect(blackView.yourPhased).toEqual([]);
    // warningSquares is numbers only — it cannot carry the piece identity ("n").
    expect(blackView.warningSquares.every((sq) => typeof sq === "number")).toBe(true);

    const whiteView = viewFor(s, "w"); // owner: full detail, no self-warning
    expect(whiteView.warningSquares).toEqual([]);
    expect(whiteView.yourPhased).toEqual([
      { type: "n", origin: 6, returnOn: 2, turnsRemaining: 1 },
    ]);

    const specView = viewFor(s, "spectator");
    expect(specView.yourPhased).toEqual([]);
    expect(specView.warningSquares).toEqual([]);
  });
});
