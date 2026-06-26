// Experiment C — TinkerChess bot vs Stockfish (classical), with timing/throughput.
//
// The TC bot plays the phase variant; Stockfish plays classical chess on the same
// board via the FEN-per-turn trick (it never sees phasing — phased TC pieces are
// just absent from the FEN it's handed). King-phasing is disabled so the FEN always
// has both kings. Stockfish is handicapped (Skill Level) toward parity so the
// PHASING variable is isolated, not drowned by raw strength. Runs two conditions —
// baseline TC vs phase-biased TC — and reports W/D/L plus per-game wall-clock
// (median, σ) and throughput.
//
// Tunables via env: N (games/condition), TC_DEPTH, SF_SKILL (0-20), SF_DEPTH,
// SF_MOVETIME (ms; overrides SF_DEPTH), BIAS (phase-biased condition's phaseBias).
import { writeFileSync, mkdirSync } from "node:fs";
import { legalMoves } from "../src/engine/index.js";
import type { GameState, RuleConfig } from "../src/engine/index.js";
import { toFEN, uciToMove, isTcLegal } from "../src/engine/classical.js";
import { search } from "../src/bot/search.js";
import { DEFAULT_WEIGHTS } from "../src/bot/evaluate.js";
import { Stockfish, type GoLimits } from "./lib/stockfish.js";
import { playGame, type Chooser } from "./lib/selfplay.js";
import { median, stddev, fmt, table } from "./lib/report.js";

const N = Number(process.env.N ?? 20);
const TC_DEPTH = Number(process.env.TC_DEPTH ?? 3);
const SF_SKILL = Number(process.env.SF_SKILL ?? 2);
const SF_DEPTH = Number(process.env.SF_DEPTH ?? 6);
const SF_MOVETIME = process.env.SF_MOVETIME ? Number(process.env.SF_MOVETIME) : undefined;
const BIAS_LOW = Number(process.env.BIAS_LOW ?? 120);
const BIAS = Number(process.env.BIAS ?? 600);

// King non-phaseable ⇒ the FEN always has both kings (a kingless FEN is illegal).
const matchConfig: RuleConfig = { maxPhaseDuration: { p: 0, n: 2, b: 2, r: 3, q: 4, k: 0 } };
const sfLimits: GoLimits = SF_MOVETIME ? { movetime: SF_MOVETIME } : { depth: SF_DEPTH };

function tcChooser(phaseBias: number): Chooser {
  const weights = { ...DEFAULT_WEIGHTS, phaseBias };
  return (state: GameState) => search(state, { maxDepth: TC_DEPTH, weights }).action;
}

function sfChooser(sf: Stockfish): Chooser {
  return async (state: GameState) => {
    const { best, ranked } = await sf.analyse(toFEN(state), sfLimits, 4);
    // Prefer the skill-adjusted bestmove; fall back to MultiPV lines if it's
    // TC-illegal (the ring rule can forbid a move classical chess allows).
    for (const uci of [best, ...ranked]) {
      if (uci && uci !== "(none)") {
        const mv = uciToMove(uci);
        if (isTcLegal(state, mv)) return { kind: "move", move: mv };
      }
    }
    return { kind: "move", move: legalMoves(state)[0]! };
  };
}

interface Condition {
  name: string;
  phaseBias: number;
}
const CONDITIONS: Condition[] = [
  { name: "baseline (bias 0)", phaseBias: 0 },
  { name: `mild bias (${BIAS_LOW})`, phaseBias: BIAS_LOW },
  { name: `heavy bias (${BIAS})`, phaseBias: BIAS },
];

async function runCondition(sf: Stockfish, cond: Condition): Promise<string[]> {
  const tc = tcChooser(cond.phaseBias);
  const sfMove = sfChooser(sf);
  let tcWins = 0;
  let draws = 0;
  let sfWins = 0;
  let tcPhaseTotal = 0;
  let phaseOutsInTcWins = 0;
  const durations: number[] = [];

  for (let i = 0; i < N; i++) {
    const tcIsWhite = i % 2 === 0;
    const choosers = tcIsWhite ? { w: tc, b: sfMove } : { w: sfMove, b: tc };
    const r = await playGame({ config: matchConfig, choosers, maxPlies: 240 });
    const tcColor = tcIsWhite ? "w" : "b";
    durations.push(r.durationMs);
    tcPhaseTotal += r.phaseOuts[tcColor];
    if (r.winner === tcColor) {
      tcWins++;
      phaseOutsInTcWins += r.phaseOuts[tcColor];
    } else if (r.winner === null) draws++;
    else sfWins++;
  }

  const med = median(durations);
  return [
    cond.name,
    String(N),
    `${tcWins}-${draws}-${sfWins}`,
    ((tcWins / N) * 100).toFixed(0) + "%",
    fmt(tcPhaseTotal / N, 2),
    String(phaseOutsInTcWins),
    fmt(med, 0),
    fmt(stddev(durations), 0),
    fmt(med > 0 ? 3_600_000 / med : 0, 0),
  ];
}

const main = async () => {
  console.log(
    `Stockfish match — N=${N}/condition, TC depth ${TC_DEPTH}, SF skill ${SF_SKILL}, ` +
      `SF ${SF_MOVETIME ? `${SF_MOVETIME}ms` : `depth ${SF_DEPTH}`}\n`,
  );
  const sf = new Stockfish();
  await sf.init(SF_SKILL);

  const header = [
    "condition", "games", "TC W-D-L", "TC win%", "phaseOut/game",
    "phaseOuts(TC wins)", "med ms", "σ ms", "games/hr",
  ];
  const rows: string[][] = [];
  for (const cond of CONDITIONS) {
    rows.push(await runCondition(sf, cond));
    console.log("  done:", cond.name);
  }
  sf.quit();

  const out = table(header, rows);
  console.log("\n" + out + "\n");
  console.log("W-D-L and win% are from the TC bot's perspective. med/σ are per-game wall-clock");
  console.log("(dominated by Stockfish thinking); games/hr = 3.6e6 / median.");

  mkdirSync("experiments/out", { recursive: true });
  writeFileSync(
    "experiments/out/stockfish.md",
    `# Stockfish match\nN=${N}, TC_DEPTH=${TC_DEPTH}, SF_SKILL=${SF_SKILL}, SF=${SF_MOVETIME ? SF_MOVETIME + "ms" : "depth " + SF_DEPTH}\n\n\`\`\`\n${out}\n\`\`\`\n`,
  );
};

main();
