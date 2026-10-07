import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Config for the CHILD PROCESSES of the process-restart proof.
 *
 * `tests/process/*.test.ts` are not tests of the suite — they are whole
 * processes that boot the real application composition, do one thing, and exit.
 * `tests/workforce-step5-app-restart.test.ts` spawns them, two different OS
 * processes, and asserts that the ONLY thing they share is the database.
 *
 * Keeping them on their own config means the main suite (`vitest.config.ts`,
 * `tests/*.test.ts`) never runs them as ordinary tests.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/process/*.test.ts"],
    setupFiles: ["tests/capital-env.setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    fileParallelism: false,
  },
});
