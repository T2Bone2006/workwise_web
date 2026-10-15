import path from "node:path";
import { defineConfig } from "vitest/config";

/** `npx vitest run -c vitest.eval.config.ts`: asks the real assistant real questions (costs a few pence). Not part of npm test. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "test/server-only.ts"),
    },
  },
  test: {
    include: ["scripts/assistant-eval/**/*.eval.ts"],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60_000,
  },
});
