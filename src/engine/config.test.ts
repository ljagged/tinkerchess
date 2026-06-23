// Tier-1 Settings: per-game RuleConfig as the single source of phase-eligibility
// and duration caps. The hardcoded MAX_PHASE_DURATION is the DEFAULT only; a game
// may override it, and the engine always reads the game's config.

import { describe, it, expect } from "vitest";
import {
  applyAction,
  createGame,
  cloneState,
  isPhaseable,
  maxDuration,
  pieceAt,
  replay,
  validatePhaseOut,
  DEFAULT_RULE_CONFIG,
} from "./index.js";
import type { Action, RuleConfig } from "./index.js";

const withOverride = (over: Partial<RuleConfig["maxPhaseDuration"]>): RuleConfig => ({
  maxPhaseDuration: { ...DEFAULT_RULE_CONFIG.maxPhaseDuration, ...over },
});

// e2=12, e4=28, c1 bishop=2, d1 queen=3, d7 black pawn=51
describe("rule config (Tier-1 Settings)", () => {
  it("default: pawns cannot phase; others use MAX_PHASE_DURATION", () => {
    expect(isPhaseable("p")).toBe(false);
    expect(isPhaseable("q")).toBe(true);
    expect(maxDuration("p")).toBe(0);
    expect(maxDuration("q")).toBe(4);
    expect(maxDuration("k")).toBe(1);
    expect(createGame().config).toEqual(DEFAULT_RULE_CONFIG);
  });

  it("accessors honor an explicit config", () => {
    const cfg = withOverride({ p: 2, n: 0 });
    expect(isPhaseable("p", cfg)).toBe(true);
    expect(maxDuration("p", cfg)).toBe(2);
    expect(isPhaseable("n", cfg)).toBe(false);
    expect(maxDuration("n", cfg)).toBe(0);
  });

  it("default ruleset rejects phasing a pawn; a pawn-phasing ruleset allows it end-to-end", () => {
    expect(validatePhaseOut(createGame(), { from: 12, duration: 1 }).ok).toBe(false);

    const game = createGame(withOverride({ p: 2 }));
    expect(validatePhaseOut(game, { from: 12, duration: 2 }).ok).toBe(true);
    const next = applyAction(game, { kind: "phaseOut", phaseOut: { from: 12, duration: 2 } });
    expect(pieceAt(next.board, 12)).toBeNull();
    expect(next.phased.some((p) => p.type === "p" && p.origin === 12)).toBe(true);
  });

  it("disabling a piece type (duration 0) forbids it phasing", () => {
    const game = createGame(withOverride({ b: 0 }));
    expect(validatePhaseOut(game, { from: 2, duration: 1 }).ok).toBe(false);
  });

  it("config caps phase duration per piece type", () => {
    const game = createGame(withOverride({ q: 1 }));
    expect(validatePhaseOut(game, { from: 3, duration: 2 }).ok).toBe(false);
    expect(validatePhaseOut(game, { from: 3, duration: 1 }).ok).toBe(true);
  });

  it("config is preserved and deep-cloned across actions and cloneState", () => {
    const cfg = withOverride({ p: 2 });
    const game = createGame(cfg);
    const next = applyAction(game, { kind: "move", move: { from: 12, to: 28 } });
    expect(next.config).toEqual(cfg);
    expect(next.config).not.toBe(game.config); // not a shared reference
    const cloned = cloneState(game);
    expect(cloned.config).toEqual(cfg);
    expect(cloned.config).not.toBe(game.config);
  });

  it("a custom-config game replays deterministically from its initial state", () => {
    const init = createGame(withOverride({ p: 2 }));
    const actions: Action[] = [
      { kind: "move", move: { from: 12, to: 28 } }, // white e2-e4
      { kind: "phaseOut", phaseOut: { from: 51, duration: 2 } }, // black d7 pawn phases (custom rule)
    ];
    let live = init;
    for (const a of actions) live = applyAction(live, a);
    expect(JSON.stringify(replay(actions, init))).toBe(JSON.stringify(live));
  });
});
