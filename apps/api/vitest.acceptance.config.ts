import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/payments.test.ts",
      "tests/billing.test.ts",
      "tests/collection-batches.test.ts",
      "tests/backup.test.ts",
    ],
    /** Only SPEC acceptance cases — avoids non-AT helpers failing the suite. */
    testNamePattern: /AT-\d{2}/,
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    reporters: ["default", "./tests/acceptance-reporter.ts"],
  },
});
