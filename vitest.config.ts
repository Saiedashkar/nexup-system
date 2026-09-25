import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolves the same `@/*` alias tsconfig/Next use, so the MCP modules
// under test can import `@/lib/prisma` exactly as in the running app.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/mcp-env.setup.ts"],
    hookTimeout: 240_000,
    testTimeout: 120_000,
    // No globalSetup: the suite owns its throwaway database lifecycle.
  },
});
