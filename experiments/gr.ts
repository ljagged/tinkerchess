// Experiment A — Game Refinement (GR = √B / D).
//
// Plays bot self-play games (randomized openings so each game differs, since the
// bot is deterministic) and measures average branching B and game length D under
// three B-definitions, for: classical chess (phasing off), TC default, and TC with
// the phaseBias knob turned up. A classical baseline near GR≈0.074 validates the
// method; the TC rows show whether phasing shifts the game's "shape".
//
// Tunables via env: N (games), DEPTH (bot ply depth), OPENING (random opening plies).
import { writeFileSync, mkdirSync } from "node:fs";
import { DEFAULT_RULE_CONFIG, legalMoves } from "../src/engine/index.js";
import type { Action, GameState, PieceType, RuleConfig } from "../src/engine/index.js";
import { mulberry32 } from "../src/engine/_testgames.js";
import { search } from "../src/bot/search.js";
import { DEFAULT_WEIGHTS } from "../src/bot/evaluate.js";
import { playGame, type Chooser, type GameResult } from "./lib/selfplay.js";
import { gr, median, fmt, table } from "./lib/report.js";

const N = Number(process.env.N ?? 40);
const DEPTH = Number(process.env.DEPTH ?? 2);
const OPENING = Number(process.env.OPENING ?? 4);

const PIECE_TYPES: PieceType[] = ["p", "n", "b", "r", "q", "k"];
const classicalConfig: RuleConfig = {
  maxPhaseDuration: Object.fromEntries(PIECE_TYPES.map((t) => [t, 0])) as Record<PieceType, number>,
};

interface ConfigDef {
  name: string;
  config: RuleConfig;
  phaseBias: number;
}
const CONFIGS: ConfigDef[] = [
  { name: "classical", config: classicalConfig, phaseBias: 0 },
  { name: "TC default", config: DEFAULT_RULE_CONFIG, phaseBias: 0 },
  { name: "TC bias=200", config: DEFAULT_RULE_CONFIG, phaseBias: 200 },
  { name: "TC bias=800", config: DEFAULT_RULE_CONFIG, phaseBias: 800 },
];

/** A chooser that plays `openingPlies` random legal moves, then hands off to the bot. */
function makeChooser(phaseBias: number, rng: () => number, openingPlies: number): Chooser {
  const weights = { ...DEFAULT_WEIGHTS, phaseBias };
  let ply = 0;
  return (state: GameState): Action => {
    ply++;
    if (ply <= openingPlies) {
      const moves = legalMoves(state);
      const m = moves[Math.floor(rng() * moves.length)]!;
      return { kind: "move", move: m };
    }
    return search(state, { maxDepth: DEPTH, weights }).action;
  };
}

async function runConfig(def: ConfigDef): Promise<string[]> {
  const results: GameResult[] = [];
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(i + 1);
    const chooser = makeChooser(def.phaseBias, rng, OPENING);
    results.push(await playGame({ config: def.config, choosers: { w: chooser, b: chooser } }));
  }
  const positions = results.reduce((a, r) => a + r.positions, 0);
  const bMove = results.reduce((a, r) => a + r.sumBMove, 0) / positions;
  const bD1 = results.reduce((a, r) => a + r.sumBD1, 0) / positions;
  const bAll = results.reduce((a, r) => a + r.sumBAll, 0) / positions;
  const plies = results.map((r) => r.plies);
  const d = plies.reduce((a, b) => a + b, 0) / plies.length;
  const phaseFrac =
    results.reduce((a, r) => a + r.phaseOuts.w + r.phaseOuts.b, 0) / Math.max(1, plies.reduce((a, b) => a + b, 0));
  const durations = results.map((r) => r.durationMs);
  const capped = results.filter((r) => r.endedBy !== "engine").length;

  return [
    def.name,
    String(N),
    fmt(d, 1),
    fmt(bMove, 1),
    fmt(bD1, 1),
    fmt(bAll, 1),
    fmt(gr(bMove, d), 4),
    fmt(gr(bD1, d), 4),
    fmt(gr(bAll, d), 4),
    (phaseFrac * 100).toFixed(1) + "%",
    fmt(median(durations), 0),
    String(capped),
  ];
}

const main = async () => {
  console.log(`Game Refinement — N=${N} games/config, bot depth ${DEPTH}, ${OPENING} random opening plies\n`);
  const header = [
    "config", "games", "D(plies)", "B_move", "B_d1", "B_all",
    "GR_move", "GR_d1", "GR_all", "phase%", "med ms", "capped",
  ];
  const rows: string[][] = [];
  for (const def of CONFIGS) {
    const row = await runConfig(def);
    rows.push(row);
    console.log("  done:", def.name);
  }
  const out = table(header, rows);
  console.log("\n" + out + "\n");
  console.log("Sweet spot per Iida/Takeshita/Yoshimura: GR ≈ 0.07–0.08. GR_move on the classical");
  console.log("row is the methodology check (our engine's chess, bot self-play).");

  mkdirSync("experiments/out", { recursive: true });
  writeFileSync(
    `experiments/out/gr.md`,
    `# Game Refinement\nN=${N}, depth=${DEPTH}, opening=${OPENING}\n\n\`\`\`\n${out}\n\`\`\`\n`,
  );
};

main();
