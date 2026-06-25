import { describe, it, expect } from "vitest";
import { applyAction, initialState, viewFor } from "../engine/index.js";
import type { GameState } from "../engine/index.js";
import { chooseAction, type PublicState } from "./index.js";

function publicOf(s: GameState): PublicState {
  return {
    config: s.config!,
    history: s.history ?? [],
    castling: s.castling,
    enPassant: s.enPassant,
  };
}

describe("chooseAction — end-to-end honest wiring", () => {
  it("returns a legal action for the opening position from the bot's own view", () => {
    const state = initialState();
    const view = viewFor(state, "w");
    const action = chooseAction(view, publicOf(state), [], { maxDepth: 2 });
    // The action the bot picked must be one the real server path would accept.
    expect(() => applyAction(state, action)).not.toThrow();
  });

  it("rejects a spectator view (no honest seat)", () => {
    const state = initialState();
    const view = viewFor(state, "spectator");
    expect(() => chooseAction(view, publicOf(state), [], { maxDepth: 1 })).toThrow();
  });
});
