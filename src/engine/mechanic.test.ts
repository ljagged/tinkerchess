import { describe, it, expect } from "vitest";
import {
  getMechanic,
  phaseMechanic,
  activeMechanics,
  activeMechanicIds,
  augmentsActive,
  createGame,
  cloneState,
  applyAction,
  legalPhaseOuts,
} from "./index.js";
import type { GameState } from "./index.js";

describe("mechanic registry — phasing (plugin #1)", () => {
  it("registers phasing and resolves it by id", () => {
    expect(getMechanic("phasing")).toBe(phaseMechanic);
  });

  it("a state with no mechanics field defaults to phasing only (back-compat)", () => {
    const legacy = { mechanics: undefined } as unknown as GameState;
    expect(activeMechanicIds(legacy)).toEqual(["phasing"]);
  });

  it("a fresh game's active mechanics are exactly [phasing]", () => {
    const g = createGame();
    expect(activeMechanicIds(g)).toEqual(["phasing"]);
    expect(activeMechanics(g).map((m) => m.id)).toEqual(["phasing"]);
  });

  it("the decision-1 attack/move fold is dormant — no augmenting mechanic is active", () => {
    expect(augmentsActive(createGame())).toBe(false);
  });

  it("phasing.legalActions mirrors legalPhaseOuts (same set, wrapped as actions)", () => {
    // a position with phaseable pieces: skip a couple plies so it's mid-opening
    let s = createGame();
    s = applyAction(s, { kind: "move", move: { from: 12, to: 28 } }); // e4
    const direct = legalPhaseOuts(s).map((p) => ({ kind: "phaseOut", phaseOut: p }));
    expect(phaseMechanic.legalActions?.(s)).toEqual(direct);
  });

  it("phasing.stateHash separates equal boards with different return timers", () => {
    const base = createGame();
    const a = cloneState(base);
    const b = cloneState(base);
    a.phased.push({ color: "w", type: "r", origin: 0, returnOn: 5 });
    b.phased.push({ color: "w", type: "r", origin: 0, returnOn: 8 });
    expect(phaseMechanic.stateHash?.(a)).not.toBe(phaseMechanic.stateHash?.(b));
  });
});
