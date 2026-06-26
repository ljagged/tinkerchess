import { describe, it, expect } from "vitest";
import { initialState } from "../engine/index.js";
import { search } from "./search.js";
import { DEFAULT_WEIGHTS, evaluate } from "./evaluate.js";

// The phaseBias experiment knob (default 0). These pin BOTH directions: 0 must be a
// no-op (the shipped bot is unchanged), and a large bias must actually flip the bot
// into phasing where it otherwise never would.
describe("phaseBias experiment knob", () => {
  it("is a no-op at 0 (eval identical to the four shipped terms)", () => {
    const state = initialState();
    // Default weights carry phaseBias: 0, so the eval equals the un-biased eval.
    expect(evaluate(state, "w", DEFAULT_WEIGHTS)).toBe(evaluate(state, "w", { ...DEFAULT_WEIGHTS, phaseBias: 0 }));
  });

  it("the default bot does not phase in the opening, but a large phaseBias makes it", () => {
    const state = initialState();
    expect(search(state, { maxDepth: 2 }).action.kind).toBe("move");

    const biased = search(state, { maxDepth: 2, weights: { ...DEFAULT_WEIGHTS, phaseBias: 5000 } });
    expect(biased.action.kind).toBe("phaseOut");
  });
});
