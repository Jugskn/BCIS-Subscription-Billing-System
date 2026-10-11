import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { desc } from "drizzle-orm";
import { backupHistory, type Database } from "@bcis/db";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { acquireWriteLock, releaseWriteLock } from "../lib/write-lock.js";

export type DbConnectionParts = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

export function parseDatabaseUrl(url: string): DbConnectionParts {
  const u = new URL(url);
  return {
    host: u.hostname || "127.0.0.1",
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || ""),
    database: u.pathname.replace(/^\//, "") || "postgres",
  };
}

function pgBin(config: AppConfig, tool: "pg_dump" | "pg_restore"): string {
  if (config.PG_BIN_DIR) {
    return join(config.PG_BIN_DIR, process.platform === "win32" ? `${tool}.exe` : tool);
  }
  return tool;
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function dirSize(path: string): Promise<bigint> {
  let total = 0n;
  async function walk(p: string) {
    const entries = await readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        const s = await stat(full);
        total += BigInt(s.size);
      }
    }
  }
  try {
    await walk(path);
  } catch {
    return 0n;
  }
  return total;
}

type Manifest = {
  timestamp: string;
  dbName: string;
  dumpFile: string;
  attachmentsDir: string;
  sizes: { dumpBytes: number; attachmentsBytes: number; totalBytes: number };
  checksumSha256: string;
  appVersion: string;
  verified?: boolean;
  verifiedAt?: string;
};

async function recordHistory(
  db: Database["db"],
  input: {
    action: string;
    backupPath: string | null;
    status: string;
    verified: boolean;
    checksumSha256?: string | null;
    sizeBytes?: bigint | null;
    message?: string | null;
    actorUserId: string;
  },
) {
  await db.insert(backupHistory).values({
    action: input.action,
    backupPath: input.backupPath,
    status: input.status,
    verified: input.verified,
    checksumSha256: input.checksumSha256 ?? null,
    sizeBytes: input.sizeBytes ?? null,
    message: input.message ?? null,
    actorUserId: input.actorUserId,
  });
}

export async function listBackups(config: AppConfig) {
  const root = resolve(config.BACKUPS_DIR);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const folder = join(root, e.name);
    const manifestPath = join(folder, "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw) as Manifest;
      items.push({
        id: e.name,
        folderName: e.name,
        path: folder,
        createdAt: manifest.timestamp,
        sizeBytes: String(manifest.sizes.totalBytes),
        verified: Boolean(manifest.verified),
        checksumSha256: manifest.checksumSha256 ?? null,
        status: manifest.verified ? "verified" : "created",
        dbName: manifest.dbName ?? null,
        appVersion: manifest.appVersion ?? null,
      });
    } catch {
      // skip incomplete folders
    }
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items };
}

export async function createBackup(
  db: Database["db"],
  config: AppConfig,
  actorUserId: string,
) {
  const parts = parseDatabaseUrl(config.DATABASE_URL);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `bcis-backup-${stamp}`;
  const root = resolve(config.BACKUPS_DIR);
  const folder = join(root, folderName);
  await mkdir(folder, { recursive: true });

  const dumpPath = join(folder, "database.dump");
  const attachmentsDest = join(folder, "attachments");
  const attachmentsSrc = resolve(
    config.ATTACHMENTS_DIR ?? config.UPLOAD_DIR,
  );

  const env = {
    ...process.env,
    PGPASSWORD: parts.password,
  };

  try {
    const dump = await runProcess(
      pgBin(config, "pg_dump"),
      [
        "-Fc",
        "-h",
        parts.host,
        "-p",
        parts.port,
        "-U",
        parts.user,
        "-d",
        parts.database,
        "-f",
        dumpPath,
      ],
      env,
    );
    if (dump.code !== 0) {
      throw new AppError(
        500,
        "BACKUP_FAILED",
        `pg_dump failed: ${dump.stderr.slice(0, 400) || "unknown error"}`,
      );
    }

    await mkdir(attachmentsDest, { recursive: true });
    try {
      await cp(attachmentsSrc, attachmentsDest, { recursive: true });
    } catch {
      // attachments folder may be empty/missing
    }

    const checksum = await sha256File(dumpPath);
    const dumpStat = await stat(dumpPath);
    const attBytes = Number(await dirSize(attachmentsDest));
    const manifest: Manifest = {
      timestamp: new Date().toISOString(),
      dbName: parts.database,
      dumpFile: "database.dump",
      attachmentsDir: "attachments",
      sizes: {
        dumpBytes: dumpStat.size,
        attachmentsBytes: attBytes,
        totalBytes: dumpStat.size + attBytes,
      },
      checksumSha256: checksum,
      appVersion: config.APP_VERSION,
      verified: false,
    };
    await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));

    await recordHistory(db, {
      action: "create",
      backupPath: folder,
      status: "success",
      verified: false,
      checksumSha256: checksum,
      sizeBytes: BigInt(manifest.sizes.totalBytes),
      message: folderName,
      actorUserId,
    });
    await writeAuditLog(db, {
      actorUserId,
      action: "backup.create",
      entityType: "backup",
      entityId: folderName,
      newValues: {
        path: folder,
        sizeBytes: manifest.sizes.totalBytes,
        checksumSha256: checksum,
      },
    });

    return {
      id: folderName,
      folderName,
      path: folder,
      createdAt: manifest.timestamp,
      sizeBytes: String(manifest.sizes.totalBytes),
      verified: false,
      checksumSha256: checksum,
      status: "created",
      dbName: parts.database,
      appVersion: config.APP_VERSION,
    };
  } catch (err) {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Backup failed";
    await recordHistory(db, {
      action: "create",
      backupPath: folder,
      status: "failed",
      verified: false,
      message,
      actorUserId,
    });
    if (err instanceof AppError) throw err;
    throw new AppError(500, "BACKUP_FAILED", message);
  }
}

export async function verifyBackup(
  db: Database["db"],
  config: AppConfig,
  actorUserId: string,
  backupId: string,
) {
  const folder = join(resolve(config.BACKUPS_DIR), backupId);
  const manifestPath = join(folder, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new AppError(404, "NOT_FOUND", "Backup manifest not found.");
  }

  const dumpPath = join(folder, manifest.dumpFile || "database.dump");
  const checksum = await sha256File(dumpPath);
  const checksumOk = checksum === manifest.checksumSha256;

  const parts = parseDatabaseUrl(config.DATABASE_URL);
  const env = { ...process.env, PGPASSWORD: parts.password };
  let listOk = false;
  let listError = "";
  try {
    const listed = await runProcess(
      pgBin(config, "pg_restore"),
      ["--list", dumpPath],
      env,
    );
    listOk = listed.code === 0;
    if (!listOk) listError = listed.stderr.slice(0, 300);
  } catch (err) {
    listError = err instanceof Error ? err.message : "pg_restore missing";
  }

  const verified = checksumOk && listOk;
  manifest.verified = verified;
  manifest.verifiedAt = new Date().toISOString();
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  await recordHistory(db, {
    action: "verify",
    backupPath: folder,
    status: verified ? "verified" : "failed",
    verified,
    checksumSha256: checksum,
    sizeBytes: BigInt(manifest.sizes.totalBytes),
    message: verified
      ? "Checksum and pg_restore --list passed"
      : `Failed: checksumOk=${checksumOk} listOk=${listOk} ${listError}`,
    actorUserId,
  });
  await writeAuditLog(db, {
    actorUserId,
    action: "backup.verify",
    entityType: "backup",
    entityId: backupId,
    newValues: { verified, checksumOk, listOk },
  });

  return {
    id: backupId,
    verified,
    checksumOk,
    listOk,
    message: verified ? "Verified" : "Failed",
  };
}

export async function restoreBackup(
  db: Database["db"],
  config: AppConfig,
  actorUserId: string,
  backupId: string,
) {
  const folder = join(resolve(config.BACKUPS_DIR), backupId);
  const manifestPath = join(folder, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new AppError(404, "NOT_FOUND", "Backup not found.");
  }
  if (!manifest.verified) {
    throw new AppError(
      409,
      "NOT_VERIFIED",
      "Backup must be verified before restore.",
    );
  }

  acquireWriteLock("Restoring database from backup");
  let safetyFolder: string | null = null;
  try {
    // Pre-restore safety backup (best-effort)
    try {
      const safety = await createBackup(db, config, actorUserId);
      safetyFolder = safety.path;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Pre-restore safety backup failed";
      throw new AppError(
        500,
        "SAFETY_BACKUP_FAILED",
        `Could not create pre-restore safety backup: ${msg}`,
      );
    }

    const parts = parseDatabaseUrl(config.DATABASE_URL);
    const dumpPath = join(folder, manifest.dumpFile || "database.dump");
    const env = { ...process.env, PGPASSWORD: parts.password };

    const restore = await runProcess(
      pgBin(config, "pg_restore"),
      [
        "--clean",
        "--if-exists",
        "-h",
        parts.host,
        "-p",
        parts.port,
        "-U",
        parts.user,
        "-d",
        parts.database,
        dumpPath,
      ],
      env,
    );
    // pg_restore may exit 1 with warnings; treat as failure only if stderr has FATAL
    if (restore.code !== 0 && /FATAL|error:/i.test(restore.stderr)) {
      throw new AppError(
        500,
        "RESTORE_FAILED",
        `pg_restore failed: ${restore.stderr.slice(0, 400)}`,
      );
    }

    const attachmentsSrc = join(folder, manifest.attachmentsDir || "attachments");
    const attachmentsDest = resolve(
      config.ATTACHMENTS_DIR ?? config.UPLOAD_DIR,
    );
    try {
      await mkdir(attachmentsDest, { recursive: true });
      await cp(attachmentsSrc, attachmentsDest, { recursive: true });
    } catch {
      // optional
    }

    await recordHistory(db, {
      action: "restore",
      backupPath: folder,
      status: "success",
      verified: true,
      checksumSha256: manifest.checksumSha256,
      sizeBytes: BigInt(manifest.sizes.totalBytes),
      message: `Restored ${backupId}; safety=${safetyFolder ?? "n/a"}`,
      actorUserId,
    });
    await writeAuditLog(db, {
      actorUserId,
      action: "backup.restore",
      entityType: "backup",
      entityId: backupId,
      newValues: { safetyBackup: safetyFolder },
    });

    return {
      ok: true,
      backupId,
      safetyBackup: safetyFolder,
      message: "Restore completed. Reconnect clients if needed.",
    };
  } catch (err) {
    const message =
      err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Restore failed";
    await recordHistory(db, {
      action: "restore",
      backupPath: folder,
      status: "failed",
      verified: false,
      message,
      actorUserId,
    }).catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(500, "RESTORE_FAILED", message);
  } finally {
    releaseWriteLock();
  }
}

export async function listBackupHistory(db: Database["db"]) {
  const rows = await db
    .select()
    .from(backupHistory)
    .orderBy(desc(backupHistory.createdAt))
    .limit(100);
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      backupPath: r.backupPath,
      status: r.status,
      verified: r.verified,
      checksumSha256: r.checksumSha256,
      sizeBytes: r.sizeBytes?.toString() ?? null,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export function backupsRoot(config: AppConfig): string {
  return resolve(config.BACKUPS_DIR);
}
