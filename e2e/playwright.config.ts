import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, CONVEX_URL, PORT } from "./support/env";

// Acceptance tests that play chess through the browser. globalSetup boots a local
// anonymous Convex backend (isolated from the repo .env.local); the Next dev server
// is pointed at it via NEXT_PUBLIC_CONVEX_URL (process env wins over .env.local).
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  webServer: {
    // Dedicated port so we never reuse/collide with whatever's on :3000.
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_CONVEX_URL: CONVEX_URL },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
