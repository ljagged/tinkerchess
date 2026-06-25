import { describe, it, expect } from "vitest";
import {
  TIME_CONTROLS,
  DEFAULT_TIME_CONTROL,
  timeControlDef,
  timeControlCategory,
  gameTypeLabel,
  resolveTimeControlId,
  newClock,
  startClock,
  applyMoveToClock,
  remainingFor,
  isExpired,
  type Clock,
} from "./timecontrol.js";

describe("time-control presets", () => {
  it("resolves known ids and falls back to the default for unknown/missing", () => {
    expect(resolveTimeControlId("blitz_3_2")).toBe("blitz_3_2");
    expect(resolveTimeControlId(undefined)).toBe(DEFAULT_TIME_CONTROL);
    expect(resolveTimeControlId("not_a_preset")).toBe(DEFAULT_TIME_CONTROL);
  });

  it("blitz 3+2 is 180s base with a 2s increment", () => {
    const def = timeControlDef("blitz_3_2")!;
    expect(def.initialMs).toBe(180_000);
    expect(def.incrementMs).toBe(2_000);
    expect(def.category).toBe("Blitz");
  });

  it("includes an untimed preset", () => {
    expect(TIME_CONTROLS.some((t) => t.id === "untimed")).toBe(true);
  });
});

describe("newClock", () => {
  it("returns undefined for untimed (no clock is stored)", () => {
    expect(newClock("untimed")).toBeUndefined();
  });

  it("seeds both sides with the base time and starts paused", () => {
    const c = newClock("rapid_10_5")!;
    expect(c.remaining).toEqual({ w: 600_000, b: 600_000 });
    expect(c.incrementMs).toBe(5_000);
    expect(c.runningSince).toBeNull();
  });
});

describe("clock math", () => {
  const base = (): Clock => newClock("blitz_3_2")!; // 180s + 2s

  it("deducts elapsed and adds the increment on a normal move", () => {
    const c = startClock(base(), 1_000);
    // White moves 4s later: 180 - 4 + 2 = 178s, opponent's clock now runs.
    const { clock, flagged } = applyMoveToClock(c, "w", 5_000, false);
    expect(flagged).toBe(false);
    expect(clock.remaining.w).toBe(178_000);
    expect(clock.remaining.b).toBe(180_000);
    expect(clock.runningSince).toBe(5_000);
  });

  it("flags (no increment) when the mover's time is exhausted", () => {
    const c = startClock(base(), 0);
    const { clock, flagged } = applyMoveToClock(c, "w", 181_000, false); // 181s > 180s
    expect(flagged).toBe(true);
    expect(clock.remaining.w).toBe(0);
    expect(clock.runningSince).toBeNull(); // paused — game is over on time
  });

  it("pauses the clock when the move ends the game", () => {
    const c = startClock(base(), 0);
    const { clock } = applyMoveToClock(c, "w", 3_000, true);
    expect(clock.runningSince).toBeNull();
    expect(clock.remaining.w).toBe(179_000); // 180 - 3 + 2, increment still granted
  });

  it("remainingFor ticks the running side down and leaves the idle side banked", () => {
    const c = startClock(base(), 10_000);
    // It's White's turn, 6s into the period.
    expect(remainingFor(c, "w", "w", 16_000)).toBe(174_000);
    expect(remainingFor(c, "b", "w", 16_000)).toBe(180_000);
    // Never negative.
    expect(remainingFor(c, "w", "w", 999_999)).toBe(0);
  });

  it("maps a preset id to its game-type category, defaulting unknown/untimed to Untimed", () => {
    expect(timeControlCategory("blitz_3_2")).toBe("Blitz");
    expect(timeControlCategory("rapid_10_5")).toBe("Rapid");
    expect(timeControlCategory("untimed")).toBe("Untimed");
    expect(timeControlCategory(undefined)).toBe("Untimed");
    expect(timeControlCategory("not_a_preset")).toBe("Untimed");
  });

  it("builds a self-contained game-type label", () => {
    expect(gameTypeLabel("blitz_3_2")).toBe("Blitz · 3 + 2");
    expect(gameTypeLabel("classical_30_0")).toBe("Classical · 30 + 0");
    expect(gameTypeLabel("untimed")).toBe("Untimed");
    expect(gameTypeLabel(undefined)).toBe("Untimed");
  });

  it("isExpired is true only once the running side crosses zero", () => {
    const c = startClock(base(), 0);
    expect(isExpired(c, "w", 179_000)).toBe(false);
    expect(isExpired(c, "w", 180_000)).toBe(true);
    // A paused clock is never expired.
    expect(isExpired({ ...c, runningSince: null }, "w", 999_999)).toBe(false);
  });
});
