// Chess clock — time controls and the pure clock math.
//
// This module is a Convex-layer / UI concern, NOT a chess rule, so it lives
// outside src/engine (the engine stays purely about board mechanics). It is
// shared by both the Convex backend (`../src/timecontrol.js`) and the frontend
// (`@/src/timecontrol`), the same dual-consumer pattern as the engine.
//
// All functions here are PURE: time is always passed in as `now` (epoch ms) so
// the math is deterministic and unit-testable. Never call Date.now() in here —
// the caller (a Convex mutation) supplies the authoritative server time.
//
// Model: single-stage Fischer increment, matching how lichess/chess.org actually
// run online games (their controls are all `base + increment`; the multi-stage
// FIDE OTB control is intentionally not modelled). A future `variant` field
// (Chess960) would live alongside the time control, not inside it.

export type TimeControlId =
  | "untimed"
  | "blitz_3_2"
  | "blitz_5_0"
  | "rapid_10_5"
  | "rapid_15_10"
  | "classical_30_0";

export type TimeControlCategory = "Untimed" | "Blitz" | "Rapid" | "Classical";

export interface TimeControlDef {
  id: TimeControlId;
  /** Short display label, e.g. "3 + 2" (base minutes + increment seconds). */
  label: string;
  category: TimeControlCategory;
  /** Starting time per player, in ms. 0 for untimed. */
  initialMs: number;
  /** Fischer increment added after each completed move, in ms. 0 for no increment. */
  incrementMs: number;
}

const MIN = 60_000;
const SEC = 1_000;

// The picker's presets, grouped (in order) by category for a lichess-style grid.
export const TIME_CONTROLS: TimeControlDef[] = [
  { id: "blitz_3_2", label: "3 + 2", category: "Blitz", initialMs: 3 * MIN, incrementMs: 2 * SEC },
  { id: "blitz_5_0", label: "5 + 0", category: "Blitz", initialMs: 5 * MIN, incrementMs: 0 },
  { id: "rapid_10_5", label: "10 + 5", category: "Rapid", initialMs: 10 * MIN, incrementMs: 5 * SEC },
  { id: "rapid_15_10", label: "15 + 10", category: "Rapid", initialMs: 15 * MIN, incrementMs: 10 * SEC },
  { id: "classical_30_0", label: "30 + 0", category: "Classical", initialMs: 30 * MIN, incrementMs: 0 },
  { id: "untimed", label: "Untimed", category: "Untimed", initialMs: 0, incrementMs: 0 },
];

/** The default time control ("Regular"): a forgiving, increment-sustainable rapid. */
export const DEFAULT_TIME_CONTROL: TimeControlId = "rapid_10_5";

/** Look up a preset by id (undefined if the id is unknown). */
export function timeControlDef(id: string | undefined): TimeControlDef | undefined {
  return TIME_CONTROLS.find((t) => t.id === id);
}

/**
 * Sanitize a client-supplied time-control id to a known preset. Unknown/missing
 * ids fall back to the default — the server NEVER trusts client-supplied ms,
 * only the id, and resolves the durations itself.
 */
export function resolveTimeControlId(id: string | undefined): TimeControlId {
  return timeControlDef(id)?.id ?? DEFAULT_TIME_CONTROL;
}

/**
 * The clock stored on a game. ABSENT (undefined) means an untimed game — that is
 * also how games created before clocks existed read, so back-compat is free.
 */
export interface Clock {
  /** Which preset produced this clock (a TimeControlId; typed `string` so a clock
   * read back from storage — where it is a plain string — is the same type). */
  preset: string;
  initialMs: number;
  incrementMs: number;
  /** Time banked for each side as of the last switch (running side ticks down from here). */
  remaining: { w: number; b: number };
  /**
   * Server epoch ms when the currently-running side's period started, or null
   * while the game is waiting for an opponent or is over (clock paused). Which
   * side is running is given by the game's `turn`, not stored here.
   */
  runningSince: number | null;
}

/** Build a fresh clock for a preset id, or undefined for untimed / unknown ids
 * (no clock stored). Accepts a plain string so a stored preset id is valid input. */
export function newClock(id: string): Clock | undefined {
  const def = timeControlDef(id);
  if (!def || def.initialMs <= 0) return undefined; // untimed
  return {
    preset: def.id,
    initialMs: def.initialMs,
    incrementMs: def.incrementMs,
    remaining: { w: def.initialMs, b: def.initialMs },
    runningSince: null,
  };
}

/** Start (or resume) the running side's clock at `now`. */
export function startClock(c: Clock, now: number): Clock {
  return { ...c, runningSince: now };
}

/**
 * Apply the mover finishing their turn. Deduct their elapsed time; if it ran out,
 * `flagged` is true (no increment is granted — the flag fell). Otherwise add the
 * Fischer increment and start the opponent's clock at `now` — unless the move just
 * ended the game (`gameOver`), in which case the clock pauses.
 */
export function applyMoveToClock(
  c: Clock,
  mover: "w" | "b",
  now: number,
  gameOver: boolean,
): { clock: Clock; flagged: boolean } {
  const elapsed = c.runningSince === null ? 0 : Math.max(0, now - c.runningSince);
  const left = c.remaining[mover] - elapsed;
  if (left <= 0) {
    return {
      clock: { ...c, remaining: { ...c.remaining, [mover]: 0 }, runningSince: null },
      flagged: true,
    };
  }
  return {
    clock: {
      ...c,
      remaining: { ...c.remaining, [mover]: left + c.incrementMs },
      runningSince: gameOver ? null : now,
    },
    flagged: false,
  };
}

/**
 * Live remaining ms for `side`, given whose `turn` it is and the current `now`.
 * The running side (side === turn, clock not paused) ticks down from its bank;
 * everyone else shows their banked time. Never returns negative. Takes only the
 * readable fields so a fog view's clock (whose `preset` is a plain string over the
 * wire) is accepted structurally.
 */
export function remainingFor(
  c: Pick<Clock, "remaining" | "runningSince">,
  side: "w" | "b",
  turn: "w" | "b",
  now: number,
): number {
  const banked = c.remaining[side];
  if (side === turn && c.runningSince !== null) {
    return Math.max(0, banked - Math.max(0, now - c.runningSince));
  }
  return Math.max(0, banked);
}

/** Whether the side to move has run out of time (only true while the clock runs). */
export function isExpired(c: Clock, turn: "w" | "b", now: number): boolean {
  if (c.runningSince === null) return false;
  return c.remaining[turn] - (now - c.runningSince) <= 0;
}
