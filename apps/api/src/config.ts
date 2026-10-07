import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(root, ".env") });

/** Dev Vite origins + packaged Electron (loadFile → file://; opaque origin may send "null"). */
export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "file://",
  "null",
] as const;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(16),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_PROOF_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  /** Comma-separated allowed Origins. Empty/unset → DEFAULT_CORS_ORIGINS. Never "*". */
  CORS_ORIGINS: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
};

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [...DEFAULT_CORS_ORIGINS];
  }
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*");
  return list.length > 0 ? list : [...DEFAULT_CORS_ORIGINS];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGINS),
  };
}
