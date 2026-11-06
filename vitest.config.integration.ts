import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: "./",
    include: ["test/**/*.integration-spec.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
