import { spawn } from "node:child_process";
import { mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONVEX_URL, CONVEX_DEPLOYMENT } from "./support/env";
import { seedHumanGame } from "./support/convex";

// Where teardown finds the backend PID (separate module load, so we pass via file).
export const PID_FILE = join(tmpdir(), "tc-e2e-convex.pid");

/** Retry `fn` until it resolves or the deadline passes (1s between attempts). */
async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new Error(`${label} not ready within ${timeoutMs}ms: ${lastErr}`);
}

/**
 * Boot a PERSISTENT local anonymous Convex backend in an ISOLATED env-file so the
 * repo's .env.local (the dev's cloud deployment) is never touched, then wait until
 * the public functions are actually callable before any spec runs. The frontend
 * (Playwright webServer) is pointed at the same backend via NEXT_PUBLIC_CONVEX_URL.
 */
export default async function globalSetup() {
  if (process.env.E2E_CONVEX_URL) {
    // Cloud-dev fallback (D1 alt): caller supplied a URL; don't boot a local backend.
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "tc-e2e-"));
  const envFile = join(dir, ".env.e2e");
  writeFileSync(envFile, `CONVEX_DEPLOYMENT=${CONVEX_DEPLOYMENT}\n`);
  // Capture the backend's output for CI debugging (e.g. a failed push) instead of
  // discarding it — the path is printed so the log is findable on failure.
  const logPath = join(dir, "convex-dev.log");
  const logFd = openSync(logPath, "a");

  const child = spawn("npx", ["convex", "dev", "--env-file", envFile, "--tail-logs", "disable"], {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    stdio: ["ignore", logFd, logFd],
    detached: true, // own process group so teardown can kill the whole tree
  });
  child.unref();
  if (child.pid) writeFileSync(PID_FILE, String(child.pid));

  // 1. Backend HTTP server up.
  await waitFor(async () => {
    const r = await fetch(`${CONVEX_URL}/version`);
    if (!r.ok) throw new Error(`/version → ${r.status}`);
  }, 90_000, `Convex backend at ${CONVEX_URL} (log: ${logPath})`);

  // 2. Functions actually PUSHED. `convex dev` brings the HTTP server up BEFORE it
  //    finishes pushing code, so on a fresh deployment the first seed can hit
  //    FunctionPathNotFound — retry until games:createGame resolves. This first
  //    successful seed is also the health-check (a misconfig fails loud here, not
  //    as a blank board deep in a spec).
  const g = await waitFor(
    () => seedHumanGame("Setup", "Check"),
    120_000,
    `Convex functions deployed (games:createGame) (log: ${logPath})`,
  );
  if (!g.gameId) throw new Error("Convex health-check failed: seedHumanGame returned no gameId");
}
