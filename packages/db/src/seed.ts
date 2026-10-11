/**
 * Entry point for `pnpm --filter @bcis/db seed`.
 * Delegates to the single workspace seed script in apps/api.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const child = spawn(
  "pnpm",
  ["--filter", "@bcis/api", "exec", "tsx", "src/scripts/seed.ts"],
  {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: process.env,
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
