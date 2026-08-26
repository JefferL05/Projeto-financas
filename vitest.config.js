import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.vitest.js", "tests/**/*.test.js"],
    testTimeout: 10000,
    coverage: {
      reporter: ["text", "json-summary"],
      exclude: ["tests/**"]
    }
  }
});
