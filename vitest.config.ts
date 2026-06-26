import { defineConfig, configDefaults } from "vitest/config";

// Vitest runs the unit/Convex-function tests. The Playwright acceptance specs under
// e2e/ and the research harness under experiments/ use different runners
// (`npm run e2e`, `npm run experiment:*`) — exclude them from collection.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "experiments/**"],
  },
});
