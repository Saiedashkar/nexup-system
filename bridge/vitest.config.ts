import path from "node:path";
import { defineConfig } from "vitest/config";

// The bridge reuses the app's verified Hermes modules via the same `@/*` alias
// tsconfig/Next use, so both sides of the trust boundary resolve identically.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "../src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
