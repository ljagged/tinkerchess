// Parallel pool runner for the boost-bias experiment (Path A — CPU parallelism).
//
// The bias harness is single-process (one CPU core). This runner forks WORKERS copies
// of it across cores, each with a DISTINCT seed (so independent opening sets), then
// pools the W/B/draw counts and reports the pooled White-score delta WITH a 95%
// confidence interval — so you can see whether the boost−baseline difference is real
// or noise. n scales with WORKERS × GAMES, so a depth-3 sample in the thousands is an
// overnight run on a many-core box (no GPU — see experiments/FINDINGS.md / the engine
// is CPU-bound alpha-beta).
//
//   WORKERS=8 GAMES=100 DEPTH=3 npm run experiment:bias:pool
//
// Tunables: WORKERS (default cpus-1), GAMES (per worker), DEPTH, OPENING_PLIES, SEED
// (base; worker i uses SEED+i). Each worker runs boost-bias.ts with JSON=1.

import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { table } from "./lib/report.js";

const WORKERS = Number(process.env.WORKERS ?? Math.max(1, cpus().length - 1));
const GAMES = Number(process.env.GAMES ?? 50);
const DEPTH = Number(process.env.DEPTH ?? 3);
const OPENING_PLIES = Number(process.env.OPENING_PLIES ?? 8);
const BASE_SEED = Number(process.env.SEED ?? 1);

interface Tally { w: number; b: number; draw: number }
interface WorkerResult { seed: number; played: number; baseline: Tally; boost: Tally; secs: number }

const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");
const SCRIPT = resolve(process.cwd(), "experiments/boost-bias.ts");

/** Run one worker (a JSON-mode boost-bias process) and resolve its parsed result. */
function runWorker(seed: number): Promise<WorkerResult | null> {
  return new Promise((res) => {
    const child = spawn(TSX, [SCRIPT], {
      env: { ...process.env, JSON: "1", GAMES: String(GAMES), DEPTH: String(DEPTH), OPENING_PLIES: String(OPENING_PLIES), SEED: String(seed) },
      stdio: ["ignore", "pipe", "ignore"], // ignore stderr (per-game progress) to keep the pool quiet
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
      try {
        res(code === 0 ? (JSON.parse(line) as WorkerResult) : null);
      } catch {
        res(null);
      }
    });
    child.on("error", () => res(null));
  });
}

const sum = (a: Tally, b: Tally): Tally => ({ w: a.w + b.w, b: a.b + b.b, draw: a.draw + b.draw });
const n = (t: Tally): number => t.w + t.b + t.draw;
const whiteScore = (t: Tally): number => (n(t) ? (t.w + 0.5 * t.draw) / n(t) : 0);
/** Standard error of the White-score mean from aggregate counts (scores in {0,0.5,1}). */
function se(t: Tally): number {
  const N = n(t);
  if (N === 0) return 0;
  const mean = whiteScore(t);
  const eSq = (t.w * 1 + t.draw * 0.25) / N; // E[s^2]
  return Math.sqrt(Math.max(0, eSq - mean * mean) / N);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  // eslint-disable-next-line no-console
  console.log(
    `boost-bias pool — ${WORKERS} workers × ${GAMES} games, depth ${DEPTH}, ${OPENING_PLIES} opening plies, seeds ${BASE_SEED}..${BASE_SEED + WORKERS - 1}\n`,
  );

  let done = 0;
  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) =>
      runWorker(BASE_SEED + i).then((r) => {
        done++;
        const tag = r ? `W%base=${(100 * whiteScore(r.baseline)).toFixed(1)} W%boost=${(100 * whiteScore(r.boost)).toFixed(1)} (${r.secs}s)` : "FAILED";
        // eslint-disable-next-line no-console
        console.log(`  [${done}/${WORKERS}] seed ${r?.seed ?? BASE_SEED + i}: ${tag}`);
        return r;
      }),
    ),
  );

  const ok = results.filter((r): r is WorkerResult => r !== null);
  if (ok.length === 0) {
    // eslint-disable-next-line no-console
    console.error("all workers failed");
    process.exit(1);
  }

  const baseline = ok.map((r) => r.baseline).reduce(sum);
  const boost = ok.map((r) => r.boost).reduce(sum);
  const played = ok.reduce((s, r) => s + r.played, 0);
  const secs = ((performance.now() - t0) / 1000).toFixed(0);

  const row = (label: string, t: Tally) => [label, String(t.w), String(t.b), String(t.draw), `${(100 * whiteScore(t)).toFixed(1)}%`];
  // eslint-disable-next-line no-console
  console.log(
    `\npooled over ${ok.length}/${WORKERS} workers — ${played} games/ruleset (${secs}s wall)\n` +
      table(["ruleset", "W", "B", "draws", "White score%"], [row("baseline [phasing]", baseline), row("boost [phasing,boost]", boost)]),
  );

  const delta = whiteScore(boost) - whiteScore(baseline);
  const seDelta = Math.sqrt(se(baseline) ** 2 + se(boost) ** 2);
  const lo = 100 * (delta - 1.96 * seDelta);
  const hi = 100 * (delta + 1.96 * seDelta);
  const sig = lo > 0 || hi < 0;
  // eslint-disable-next-line no-console
  console.log(
    `\nWhite-score DELTA (boost − baseline): ${(100 * delta >= 0 ? "+" : "")}${(100 * delta).toFixed(1)} pts` +
      `  (95% CI ${lo >= 0 ? "+" : ""}${lo.toFixed(1)} .. ${hi >= 0 ? "+" : ""}${hi.toFixed(1)})\n` +
      (sig
        ? delta > 0
          ? "→ SIGNIFICANT: boost raises White's score (amplifies the first-move edge)."
          : "→ SIGNIFICANT: boost lowers White's score (dampens the first-move edge)."
        : "→ NOT significant: the CI spans 0 — no detectable effect of boost on White's edge at this sample/depth."),
  );
  // eslint-disable-next-line no-console
  console.log("\nLIMITS: fixed-depth bot (read the delta, not absolute %), full-information (no fog).");
}

void main();
