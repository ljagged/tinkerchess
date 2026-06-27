// Experiment — Boost one-shot classifier (plan Stage 5).
//
// The open question boost raises: is a forced one-shot — an immediate boost that mates
// in a single turn — reachable from a roughly EQUAL position (a genuine game-changer),
// or do they only land in positions the opponent has already lost (blunder-punishers)?
//
// Method: sample positions from seeded random boost-enabled games, and at each position
// enumerate every IMMEDIATE boost (boost + move this turn, paid at the premium price).
// Any that leaves the opponent checkmated is a one-shot. Each one-shot is classified by
// the mover's handcrafted eval of the position BEFORE the boost:
//   - equality       |eval| <  EQ      → a one-shot from a balanced board (the headline)
//   - already-winning  eval >=  EQ      → blunder-punishing (already converting a win)
//   - from-behind      eval <= -EQ      → a swindle (mating while materially worse)
// We also note whether the SAME mate was reachable WITHOUT boosting (a classical mate
// in the position) — if so the boost added nothing.
//
// HONEST LIMIT: "one-shot" here is mate-in-0 after the boost move (the boost move is
// itself checkmate). Deeper forced mates (boost then a short forced sequence) are out
// of scope for this first pass. Tunables: GAMES, MAX_PLIES, EQ (centipawns), SEED.

import {
  applyAction,
  createGame,
  legalMoves,
  legalBoosts,
  legalImmediateBoosts,
  type Action,
  type GameState,
} from "../src/engine/index.js";
import { evaluate } from "../src/bot/index.js"; // importing bot registers the boost eval term
import { table } from "./lib/report.js";

const GAMES = Number(process.env.GAMES ?? 200);
const MAX_PLIES = Number(process.env.MAX_PLIES ?? 40);
const EQ = Number(process.env.EQ ?? 150); // |eval| < EQ ⇒ "equality" (centipawns)
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

/** Random legal actions for a boost game: ordinary moves + standing boosts. */
function sampleActions(state: GameState): Action[] {
  const out: Action[] = [];
  for (const move of legalMoves(state)) out.push({ kind: "move", move });
  for (const boost of legalBoosts(state)) out.push({ kind: "boost", boost });
  return out;
}

const mover = (s: GameState): "w" | "b" => s.turn;
const won = (s: GameState, c: "w" | "b"): boolean => s.status === (c === "w" ? "w_won" : "b_won");

/** Does ANY ordinary (non-boost) move already checkmate here? (A classical one-shot.) */
function hasClassicalMate(state: GameState): boolean {
  const c = mover(state);
  for (const move of legalMoves(state)) {
    if (won(applyAction(state, { kind: "move", move }), c)) return true;
  }
  return false;
}

interface Tally {
  positions: number;
  withOneShot: number;
  equality: number;
  winning: number;
  behind: number;
  /** one-shots whose mate was NOT available classically (boost genuinely created it) */
  boostOnly: number;
}

function run(): Tally {
  const rand = mulberry32(SEED);
  const t: Tally = { positions: 0, withOneShot: 0, equality: 0, winning: 0, behind: 0, boostOnly: 0 };

  for (let g = 0; g < GAMES; g++) {
    let state = createGame(undefined, { mechanics: ["phasing", "boost"] });
    for (let ply = 0; ply < MAX_PLIES && state.status === "active"; ply++) {
      const c = mover(state);
      const oneShots = legalImmediateBoosts(state).filter((b) =>
        won(applyAction(state, { kind: "boost", boost: b }), c),
      );
      t.positions++;
      if (oneShots.length > 0) {
        t.withOneShot++;
        const evalForMover = evaluate(state, c); // before any boost; + favours the mover
        if (Math.abs(evalForMover) < EQ) t.equality++;
        else if (evalForMover >= EQ) t.winning++;
        else t.behind++;
        if (!hasClassicalMate(state)) t.boostOnly++;
      }
      const options = sampleActions(state);
      if (options.length === 0) break;
      state = applyAction(state, options[Math.floor(rand() * options.length)]!);
    }
  }
  return t;
}

const t = run();
const pct = (n: number) => (t.withOneShot ? `${((100 * n) / t.withOneShot).toFixed(0)}%` : "—");
// eslint-disable-next-line no-console
console.log(
  `boost one-shot scan — ${GAMES} games, ${MAX_PLIES} plies, EQ=${EQ}cp, seed ${SEED}\n` +
    `positions scanned: ${t.positions}\n` +
    `positions with a one-shot mate: ${t.withOneShot}\n`,
);
console.log(
  table(
    ["classification", "count", "share of one-shots"],
    [
      ["from equality (game-changer)", String(t.equality), pct(t.equality)],
      ["already winning (blunder-punish)", String(t.winning), pct(t.winning)],
      ["from behind (swindle)", String(t.behind), pct(t.behind)],
      ["mate NOT available classically", String(t.boostOnly), pct(t.boostOnly)],
    ],
  ),
);
console.log(
  t.equality > 0
    ? `\nVERDICT: forced boost one-shots ARE reachable from equality (${t.equality} found) — boost can be a game-changer, not only a blunder-punisher.`
    : `\nVERDICT: no one-shot mate arose from an equal position in this sample — consistent with boost being a blunder-punisher (widen GAMES/MAX_PLIES to stress further).`,
);
