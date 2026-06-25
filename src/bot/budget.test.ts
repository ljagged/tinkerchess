import { describe, it, expect } from "vitest";
import { moveTimeBudgetMs, UNTIMED_BUDGET_MS } from "./budget.js";

describe("moveTimeBudgetMs", () => {
  it("caps a healthy clock at the per-move maximum (2000ms)", () => {
    // 10+5: 600s remaining, 5s increment ⇒ target is huge, clamped to MAX.
    expect(moveTimeBudgetMs(600_000, 5_000)).toBe(2000);
    // 3+2 fresh: still well above the cap.
    expect(moveTimeBudgetMs(180_000, 2_000)).toBe(2000);
  });

  it("ramps the budget down as a no-increment clock depletes", () => {
    // 5+0 mid-pressure: 9s left ⇒ 9000/30 = 300ms.
    expect(moveTimeBudgetMs(9_000, 0)).toBe(300);
    // Tighter: 3s left ⇒ 3000/30 = 100ms (still above the 50ms floor).
    expect(moveTimeBudgetMs(3_000, 0)).toBe(100);
    // Real time pressure: 1.2s left ⇒ 40 target, raised to the 50ms floor.
    expect(moveTimeBudgetMs(1_200, 0)).toBe(50);
  });

  it("never thinks within the safety margin of flagging", () => {
    // Whatever the inputs, the result must be strictly usable (< remaining).
    for (const [rem, inc] of [
      [600_000, 5_000],
      [9_000, 0],
      [1_000, 0],
      [400, 0],
      [150, 0],
    ] as const) {
      expect(moveTimeBudgetMs(rem, inc)).toBeLessThan(rem);
    }
  });

  it("returns a tiny floor when almost out of time (never longer than what's left)", () => {
    expect(moveTimeBudgetMs(150, 0)).toBeLessThanOrEqual(150);
    expect(moveTimeBudgetMs(150, 0)).toBeGreaterThan(0);
    expect(moveTimeBudgetMs(10, 0)).toBe(10); // less than the 50ms floor ⇒ capped to remaining
  });

  it("an increment sustains a higher budget than the same clock without one", () => {
    // With a low base but a fat increment, the increment term dominates.
    expect(moveTimeBudgetMs(30_000, 10_000)).toBeGreaterThan(moveTimeBudgetMs(30_000, 0));
  });

  it("exposes a fixed untimed default", () => {
    expect(UNTIMED_BUDGET_MS).toBe(1000);
  });
});
