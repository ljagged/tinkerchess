// Boost eval term: a boost is valued only when "boost" is active, and it never
// perturbs classical/phasing eval (resolveEvalTerms gates it by mechanic id).

import { describe, it, expect } from "vitest";
import "./boostEval.js"; // register the term
import { evaluate, resolveEvalTerms } from "./evaluate.js";
import { createGame, parseSquare } from "../engine/index.js";
import type { GameState } from "../engine/index.js";

const sq = parseSquare;

function boostGame(): GameState {
  return createGame(undefined, { mechanics: ["phasing", "boost"] });
}

describe("boost eval term", () => {
  it("is folded in only for boost-active games", () => {
    expect(resolveEvalTerms(createGame())).toHaveLength(0); // phasing has no bot eval term
    expect(resolveEvalTerms(boostGame())).toHaveLength(1); // boost contributes one
  });

  it("a white Amazon boost raises White's score; the same for Black lowers it", () => {
    const base = boostGame();
    const baseScore = evaluate(base, "w");

    const wAmazon = boostGame();
    wAmazon.boosts = [{ color: "w", square: sq("d1"), base: "q", expiresOn: 99 }];
    expect(evaluate(wAmazon, "w")).toBeGreaterThan(baseScore);

    const bAmazon = boostGame();
    bAmazon.boosts = [{ color: "b", square: sq("d8"), base: "q", expiresOn: 99 }];
    expect(evaluate(bAmazon, "w")).toBeLessThan(baseScore);
  });

  it("does not change a classical/phasing game's evaluation", () => {
    const g = createGame(); // phasing-only; boost term must not apply even though registered
    // Even if a stray boosts array were present, a non-boost game never resolves the term.
    expect(resolveEvalTerms(g)).toHaveLength(0);
  });
});
