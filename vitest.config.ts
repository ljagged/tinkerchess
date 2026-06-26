import { defineConfig, configDefaults } from "vitest/config";

// Vitest runs the unit/Convex-function tests. The Playwright acceptance specs under
// e2e/ use a different runner (`npm run e2e`) — exclude them so vitest doesn't try
// to collect *.spec.ts there.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
