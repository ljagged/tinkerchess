import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONVEX_URL, CONVEX_DEPLOYMENT } from "./support/env";
import { seedHumanGame } from "./support/convex";

// Where teardown finds the backend PID (separate module load, so we pass via file).
export const PID_FILE = join(tmpdir(), "tc-e2e-convex.pid");

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Convex local backend not healthy at ${url} within ${timeoutMs}ms: ${lastErr}`);
}

/**
 * Boot a PERSISTENT local anonymous Convex backend in an ISOLATED env-file so the
 * repo's .env.local (the dev's cloud deployment) is never touched, then prove the
 * public API works before any spec runs. The frontend (Playwright webServer) is
 * pointed at the same backend via NEXT_PUBLIC_CONVEX_URL in playwright.config.ts.
 */
export default async function globalSetup() {
  if (process.env.E2E_CONVEX_URL) {
    // Cloud-dev fallback (D1 alt): caller supplied a URL; don't boot a local backend.
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "tc-e2e-"));
  const envFile = join(dir, ".env.e2e");
  writeFileSync(envFile, `CONVEX_DEPLOYMENT=${CONVEX_DEPLOYMENT}\n`);

  const child = spawn("npx", ["convex", "dev", "--env-file", envFile, "--tail-logs", "disable"], {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    stdio: "ignore",
    detached: true, // own process group so teardown can kill the whole tree
  });
  child.unref();
  if (child.pid) writeFileSync(PID_FILE, String(child.pid));

  await waitForHealth(`${CONVEX_URL}/version`, 90_000);

  // Health-check: a misconfig should fail loud HERE, not as a blank board in a spec.
  const g = await seedHumanGame("Setup", "Check");
  if (!g.gameId) throw new Error("Convex health-check failed: seedHumanGame returned no gameId");
}
