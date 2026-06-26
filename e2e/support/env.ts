// Shared e2e config. The local anonymous Convex backend always serves at 3210
// (its default port); override via E2E_* only for the cloud-dev fallback (D1 alt).
// CONVEX_DEPLOYMENT is the anonymous deployment name the agent bootstrap creates.
export const CONVEX_URL = process.env.E2E_CONVEX_URL ?? "http://127.0.0.1:3210";
export const CONVEX_DEPLOYMENT = process.env.E2E_CONVEX_DEPLOYMENT ?? "anonymous:anonymous-agent";

// Run the e2e Next server on a DEDICATED port so it never collides with (or
// reuses) whatever the developer already has on the default 3000.
export const PORT = process.env.E2E_PORT ?? "3100";
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
