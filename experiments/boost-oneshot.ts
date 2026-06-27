// Experiment — Boost one-shot classifier (plan Stage 5).
//
// A boost "one-shot" = an immediate boost whose move is itself checkmate (mate-in-0
// after boosting). The question: are one-shots FORCED (the opponent could not avoid
// them) or merely BLUNDER-PUNISHING (the opponent walked into one they could have
// sidestepped)?
//
// AVOIDABILITY is the honest test (not static eval). For each one-shot found at S (the
// mover c to move), look back one ply to S_prev, where the opponent was to move and
// chose the action that reached S. If EVERY legal opponent action at S_prev leaves c
// with a one-shot, the opponent was forced into it — a genuine one-shot, independent of
// any blunder. If some action avoids it, this instance was a blunder-punish.
//
// We also flag whether the mate existed WITHOUT boost (a classical mate-in-1) — a
// "boost-only" mate is one the fairy power created — and track the mover's color.
//
// HONEST LIMITS (read before quoting a number):
//   1. "Forced" here is ONE ply — the opponent's immediately preceding move. It does
//      NOT mean reachable under perfect play from the opening (that needs deep search).
//   2. Positions come from SEEDED RANDOM play, so S_prev itself need not arise under
//      strong play; avoidability is a true local property of S_prev regardless.
//   3. Random play has no competitive side bias beyond turn parity, so the White/Black
//      split below CANNOT measure the classical ~52–56% white edge — that needs strong
//      self-play with decisive-result counts by color (a separate, larger experiment).
// Tunables: GAMES, MAX_PLIES, SEED, EQ (centipawns, for the secondary eval readout).

import {
  applyAction,
  createGame,
  legalMoves,
  legalBoosts,
  legalImmediateBoosts,
  type Action,
  type Color,
  type GameState,
} from "../src/engine/index.js";
import { evaluate } from "../src/bot/index.js"; // importing bot registers the boost eval term
import { table } from "./lib/report.js";

const GAMES = Number(process.env.GAMES ?? 200);
const MAX_PLIES = Number(process.env.MAX_PLIES ?? 40);
const EQ = Number(process.env.EQ ?? 150);
const SEED = Number(process.env.SEED ?? 1);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const won = (s: GameState, c: Color): boolean => s.status === (c === "w" ? "w_won" : "b_won");

/** Legal actions for a boost game: ordinary moves + standing (non-immediate) boosts. */
function actions(state: GameState): Action[] {
  const out: Action[] = [];
  for (const move of legalMoves(state)) out.push({ kind: "move", move });
  for (const boost of legalBoosts(state)) out.push({ kind: "boost", boost });
  return out;
}

/** Does the side to move have an immediate boost that mates this turn? */
function hasOneShotMate(state: GameState): boolean {
  const c = state.turn;
  return legalImmediateBoosts(state).some((b) => won(applyAction(state, { kind: "boost", boost: b }), c));
}

/** Does ANY ordinary (non-boost) move already mate? (A classical mate-in-1.) */
function hasClassicalMate(state: GameState): boolean {
  const c = state.turn;
  return legalMoves(state).some((m) => won(applyAction(state, { kind: "move", move: m }), c));
}

/**
 * Was the one-shot at `s` (mover `c` to move) UNAVOIDABLE on the opponent's last move?
 * True iff every legal opponent action at `prev` leaves `c` with a one-shot mate. A
 * game-ending opponent action (or one that removes the one-shot) counts as "avoided".
 */
function forcedOnLastPly(prev: GameState, c: Color): boolean {
  const opts = actions(prev);
  if (opts.length === 0) return false;
  for (const a of opts) {
    const after = applyAction(prev, a);
    if (after.status !== "active" || after.turn !== c) return false; // opponent sidestepped
    if (!hasOneShotMate(after)) return false; // an opponent action with no one-shot ⇒ avoidable
  }
  return true;
}

interface Tally {
  positions: number;
  oneShots: number;
  forced: number;
  avoidable: number;
  forcedBoostOnly: number; // forced AND no classical mate (the strongest: unavoidable + boost-created)
  byColor: { w: number; b: number };
  classicalMateByColor: { w: number; b: number }; // baseline for the (caveated) color split
  forcedEqualEval: number; // forced one-shots whose pre-boost |eval| < EQ (secondary)
}

function run(): Tally {
  const rand = mulberry32(SEED);
  const t: Tally = {
    positions: 0,
    oneShots: 0,
    forced: 0,
    avoidable: 0,
    forcedBoostOnly: 0,
    byColor: { w: 0, b: 0 },
    classicalMateByColor: { w: 0, b: 0 },
    forcedEqualEval: 0,
  };

  for (let g = 0; g < GAMES; g++) {
    let prev: GameState | null = null;
    let state = createGame(undefined, { mechanics: ["phasing", "boost"] });
    for (let ply = 0; ply < MAX_PLIES && state.status === "active"; ply++) {
      const c = state.turn;
      t.positions++;
      if (hasClassicalMate(state)) t.classicalMateByColor[c]++;

      if (hasOneShotMate(state)) {
        t.oneShots++;
        t.byColor[c]++;
        const boostOnly = !hasClassicalMate(state);
        const forced = prev !== null && forcedOnLastPly(prev, c);
        if (forced) {
          t.forced++;
          if (boostOnly) t.forcedBoostOnly++;
          if (Math.abs(evaluate(state, c)) < EQ) t.forcedEqualEval++;
        } else {
          t.avoidable++;
        }
      }

      const opts = actions(state);
      if (opts.length === 0) break;
      prev = state;
      state = applyAction(state, opts[Math.floor(rand() * opts.length)]!);
    }
  }
  return t;
}

const t = run();
const share = (n: number) => (t.oneShots ? `${((100 * n) / t.oneShots).toFixed(0)}%` : "—");

// eslint-disable-next-line no-console
console.log(
  `boost one-shot scan — ${GAMES} games, ${MAX_PLIES} plies, seed ${SEED}\n` +
    `positions scanned: ${t.positions}\n` +
    `positions with a one-shot mate: ${t.oneShots}\n`,
);
console.log(
  table(
    ["classification (1-ply)", "count", "share"],
    [
      ["FORCED — opponent could not avoid it", String(t.forced), share(t.forced)],
      ["  …and impossible without boost", String(t.forcedBoostOnly), share(t.forcedBoostOnly)],
      ["  …and from a materially-even board", String(t.forcedEqualEval), share(t.forcedEqualEval)],
      ["AVOIDABLE — a blunder-punish", String(t.avoidable), share(t.avoidable)],
    ],
  ),
);
console.log(
  "\ncolor of the one-shotting side (random play — NOT a competitive-bias measurement):\n" +
    table(
      ["", "White", "Black"],
      [
        ["boost one-shots", String(t.byColor.w), String(t.byColor.b)],
        ["classical mate-in-1 (baseline)", String(t.classicalMateByColor.w), String(t.classicalMateByColor.b)],
      ],
    ),
);
console.log(
  t.forced > 0
    ? `\nVERDICT: ${t.forced} one-shot(s) were UNAVOIDABLE on the opponent's last move` +
        ` (${t.forcedBoostOnly} of them impossible without boost) — boost can force a result, not only punish a blunder.` +
        ` Caveat: this is 1-ply forcedness from random-play positions, not perfect-play-from-the-opening.`
    : `\nVERDICT: every one-shot in this sample was AVOIDABLE on the opponent's last move — consistent with boost being a blunder-punisher at this depth/sample. Widen GAMES/MAX_PLIES or deepen the forcedness test to stress further.`,
);
