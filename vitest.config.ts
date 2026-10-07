import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolves the same `@/*` alias tsconfig/Next use, so service modules
// under test can import `@/lib/capital` exactly as in the running app.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // ONE level: the suite is `tests/*.test.ts`. `tests/process/*.test.ts`
    // holds the child processes of the restart proof, which run under
    // `vitest.process.config.ts` and must not be collected here.
    include: ["tests/*.test.ts"],
    setupFiles: ["tests/capital-env.setup.ts"],
    hookTimeout: 240_000,
    testTimeout: 120_000,
    // Each test file owns the throwaway database lifecycle (create →
    // migrate → drop), so files must not run concurrently against it.
    fileParallelism: false,
  },
});
