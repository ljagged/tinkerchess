import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { PID_FILE } from "./global-setup";

/** Kill the local Convex backend (and its child backend binary). Best-effort and
 *  idempotent — a crashed run still gets cleaned up on the next teardown. */
export default async function globalTeardown() {
  try {
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM"); // detached ⇒ kill the whole process group
      } catch {
        /* group already gone */
      }
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no pid file (e.g. cloud-dev fallback) */
  }
  // The convex CLI spawns a child `convex-local-backend`; make sure it's gone.
  // execFileSync (no shell) with a fixed arg array — no injection surface.
  try {
    execFileSync("pkill", ["-f", "convex-local-backend"], { stdio: "ignore" });
  } catch {
    /* nothing to kill */
  }
  try {
    rmSync(PID_FILE);
  } catch {
    /* already removed */
  }
}
