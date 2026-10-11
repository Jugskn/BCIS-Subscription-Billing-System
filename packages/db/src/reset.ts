/**
 * Recreate the target database, apply migrations, then seed.
 * Lab only — requires APP_ENV=development|test.
 */
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

function assertLabEnv() {
  const appEnv = (process.env.APP_ENV ?? "").toLowerCase();
  if (appEnv !== "development" && appEnv !== "test") {
    console.error(
      `Refusing to reset: APP_ENV must be development or test (got ${process.env.APP_ENV ?? "(unset)"}).`,
    );
    process.exit(1);
  }
}

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

assertLabEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, "");
if (!dbName) {
  console.error("DATABASE_URL must include a database name");
  process.exit(1);
}

console.log(`Target database: ${dbName}`);
console.log(`APP_ENV: ${process.env.APP_ENV}`);

const adminUrl = new URL(url);
adminUrl.pathname = "/postgres";

const admin = postgres(adminUrl.toString(), { max: 1 });
try {
  console.log(`Dropping and recreating database "${dbName}"…`);
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
} finally {
  await admin.end({ timeout: 5 });
}

console.log("Running migrations…");
await run("pnpm", ["db:migrate"]);
console.log("Running seed…");
await run("pnpm", ["db:seed"]);
console.log("Database reset complete.");
