// Minimal UCI driver for the bundled Stockfish 18 (wasm) engine, spawned as a
// long-lived child process with a persistent stdin (a closed stdin makes the
// emscripten build exit before answering — hence one process for the whole run,
// not one per move). Used only by the Stockfish experiment.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// "lite-single": single-threaded, fast to load, far stronger than needed here.
const ENGINE_PATH = require.resolve("stockfish/bin/stockfish-18-lite-single.js");

export interface GoLimits {
  depth?: number;
  movetime?: number;
  nodes?: number;
}

interface Waiter {
  done: (line: string) => boolean;
  resolve: (lines: string[]) => void;
  lines: string[];
}

export class Stockfish {
  private proc: ChildProcessWithoutNullStreams;
  private buf = "";
  private waiters: Waiter[] = [];

  constructor() {
    this.proc = spawn(process.execPath, [ENGINE_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d: Buffer) => this.onData(d.toString()));
  }

  private onData(s: string): void {
    this.buf += s;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      for (const w of this.waiters) w.lines.push(line);
      for (let k = this.waiters.length - 1; k >= 0; k--) {
        const w = this.waiters[k]!;
        if (w.done(line)) {
          this.waiters.splice(k, 1);
          w.resolve(w.lines);
        }
      }
    }
  }

  private send(cmd: string): void {
    this.proc.stdin.write(cmd + "\n");
  }

  private until(done: (line: string) => boolean): Promise<string[]> {
    return new Promise((resolve) => {
      const w: Waiter = { done, resolve, lines: [] };
      this.waiters.push(w);
    });
  }

  async init(skill?: number): Promise<void> {
    this.send("uci");
    await this.until((l) => l === "uciok");
    if (skill !== undefined) this.send(`setoption name Skill Level value ${skill}`);
    this.send("isready");
    await this.until((l) => l === "readyok");
  }

  /**
   * Analyse a FEN and return the best move plus the MultiPV-ranked first moves (UCI),
   * so a TC-illegal bestmove (e.g. forbidden by the ring rule) can fall back to the
   * next legal line.
   */
  async analyse(fen: string, limits: GoLimits, multipv = 1): Promise<{ best: string; ranked: string[] }> {
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    const go =
      "go" +
      (limits.depth ? ` depth ${limits.depth}` : "") +
      (limits.movetime ? ` movetime ${limits.movetime}` : "") +
      (limits.nodes ? ` nodes ${limits.nodes}` : "");
    this.send(go);
    const lines = await this.until((l) => l.startsWith("bestmove"));

    const pv: Record<number, string> = {};
    for (const l of lines) {
      const m = l.match(/^info .*\bmultipv (\d+)\b.*\bpv (\S+)/);
      if (m) pv[Number(m[1])] = m[2]!;
    }
    const ranked = Object.keys(pv)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => pv[k]!);
    const best = lines.find((l) => l.startsWith("bestmove"))!.split(" ")[1] ?? "(none)";
    return { best, ranked: ranked.length ? ranked : [best] };
  }

  quit(): void {
    try {
      this.send("quit");
    } catch {
      /* already gone */
    }
    this.proc.kill();
  }
}
