// Post-game reveal view: exposes BOTH sides' phased pieces (replay only).

import { describe, it, expect } from "vitest";
import { applyAction, createGame, parseSquare, revealView, viewFor } from "./index.js";

const sq = (alg: string) => parseSquare(alg);

describe("revealView", () => {
  it("exposes both sides' phased pieces, where viewFor hides the opponent's", () => {
    let s = applyAction(createGame(), { kind: "phaseOut", phaseOut: { from: sq("d1"), duration: 4 } });
    s = applyAction(s, { kind: "phaseOut", phaseOut: { from: sq("d8"), duration: 4 } });

    const rv = revealView(s);
    expect(rv.phased).toHaveLength(2);
    expect(rv.phased.map((p) => p.color).sort()).toEqual(["b", "w"]);
    expect(rv.phased.every((p) => p.type === "q")).toBe(true);

    // The live fog view still hides the opponent's phased piece.
    expect(viewFor(s, "w").yourPhased).toHaveLength(1);
    expect(viewFor(s, "b").yourPhased).toHaveLength(1);
  });
});
