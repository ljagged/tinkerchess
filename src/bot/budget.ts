// Time management for the bot's per-move search budget.
//
// In a TIMED game the budget is a slice of the bot's OWN remaining clock time plus
// most of the Fischer increment, clamped to a sane band and always leaving a safety
// margin so the bot never thinks itself into a flag. The increment term is what
// makes this sustainable: spending ~the increment per move is roughly break-even,
// so an increment game holds a higher budget deep into the game while a no-increment
// game ramps the budget down as the clock depletes.
//
// In an UNTIMED game there is no clock to spend from, so a fixed, responsive budget
// is used (kept modest so a human isn't left waiting and the Convex action stays
// well within its limits).
//
// Pure and deterministic: no Date.now, no Math.random. The caller supplies the
// remaining/increment; the engine-purity rule still holds (this lives in src/bot).

/** Fixed per-move budget (ms) for untimed games — no clock pressure, keep it snappy. */
export const UNTIMED_BUDGET_MS = 1000;

/** Rough horizon for slicing the base time across the rest of the game. */
const EXPECTED_MOVES_LEFT = 30;
/** Spend most of the increment — it is (mostly) replenished each move. */
const INCREMENT_FRACTION = 0.8;
/** Always think at least a little, even in time pressure. */
const MIN_BUDGET_MS = 50;
/** Cap a single move: keeps play responsive and the Convex action bounded. */
const MAX_BUDGET_MS = 2000;
/** Never think within this margin of flagging — leave a buffer for overhead. */
const SAFETY_MS = 200;

/**
 * Per-move think time (ms) for a TIMED game, from the bot's remaining clock time
 * and the Fischer increment. Always returns a value strictly usable without
 * flagging: at most `remainingMs - SAFETY_MS` (or a tiny floor when almost out).
 */
export function moveTimeBudgetMs(remainingMs: number, incrementMs: number): number {
  const usable = remainingMs - SAFETY_MS;
  if (usable <= 0) {
    // Almost out of time: move near-instantly, but never longer than what's left.
    return Math.max(0, Math.min(MIN_BUDGET_MS, remainingMs));
  }
  const target = remainingMs / EXPECTED_MOVES_LEFT + incrementMs * INCREMENT_FRACTION;
  const clamped = Math.max(MIN_BUDGET_MS, Math.min(MAX_BUDGET_MS, target));
  return Math.min(clamped, usable);
}
