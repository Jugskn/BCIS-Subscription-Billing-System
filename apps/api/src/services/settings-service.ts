import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  accountSequences,
  applicationSettings,
  auditLogs,
  users,
  type Database,
} from "@bcis/db";
import {
  GCASH_DUPLICATE_POLICY,
  SETTING_DEFAULTS,
  SETTING_DEFS,
  SETTING_KEYS,
  keysForSection,
  parseSettingValue,
  type SettingKey,
  type SettingSection,
  type SettingsMap,
  type UpdateSettingsInput,
} from "@bcis/shared";
import type { AppConfig } from "../config.js";
import { AppError, validationError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";

type Db = Database["db"];
type DbReader = Pick<Db, "select">;
type DbWriter = Pick<Db, "select" | "insert" | "update">;

const CACHE_TTL_MS = 3_000;

type CacheEntry = {
  at: number;
  values: SettingsMap;
};

let cache: CacheEntry | null = null;

export function invalidateSettingsCache(): void {
  cache = null;
}

function coerceStored(key: SettingKey, raw: unknown): unknown {
  const parsed = parseSettingValue(key, raw);
  if (parsed.ok) return parsed.value;
  return SETTING_DEFAULTS[key];
}

async function loadAllFromDb(db: DbReader): Promise<SettingsMap> {
  const rows = await db.select().from(applicationSettings);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const values = {} as SettingsMap;
  for (const key of SETTING_KEYS) {
    if (byKey.has(key)) {
      values[key] = coerceStored(key, byKey.get(key));
    } else {
      values[key] = SETTING_DEFAULTS[key];
    }
  }
  return values;
}

/** Ensure missing keys exist (no migration needed for key/value store). */
export async function ensureSettingDefaults(
  db: DbWriter,
  actorUserId?: string | null,
): Promise<void> {
  for (const key of SETTING_KEYS) {
    await db
      .insert(applicationSettings)
      .values({
        key,
        value: SETTING_DEFAULTS[key],
        updatedBy: actorUserId ?? null,
      })
      .onConflictDoNothing();
  }
  invalidateSettingsCache();
}

export async function getAllSettings(db: DbReader): Promise<SettingsMap> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.values };
  }
  const values = await loadAllFromDb(db);
  cache = { at: now, values };
  return { ...values };
}

export async function getSettingValue<T = unknown>(
  db: DbReader,
  key: SettingKey,
): Promise<T> {
  const all = await getAllSettings(db);
  return all[key] as T;
}

export async function getGraceDays(db: DbReader): Promise<number> {
  return getSettingValue<number>(db, "grace_days");
}

export async function getPenaltiesEnabled(db: DbReader): Promise<boolean> {
  return getSettingValue<boolean>(db, "penalties_enabled");
}

/** Arrears threshold (centavos) for suspension candidates. */
export async function getSuspensionThresholdCentavos(
  db: DbReader,
): Promise<bigint> {
  const value = await getSettingValue<number>(db, "suspension_threshold_centavos");
  return BigInt(value);
}

export async function getSuspensionThresholdMonths(
  db: DbReader,
): Promise<number> {
  return getSettingValue<number>(db, "suspension_threshold_months");
}

export async function getFollowUpThresholdDays(db: DbReader): Promise<number> {
  return getSettingValue<number>(db, "follow_up_threshold_days");
}

export async function getInvoiceNumberPrefix(db: DbReader): Promise<string> {
  return getSettingValue<string>(db, "invoice_number_prefix");
}

export async function getReceiptNumberPrefix(db: DbReader): Promise<string> {
  return getSettingValue<string>(db, "receipt_number_prefix");
}

export async function getLoginSecuritySettings(db: DbReader): Promise<{
  maxAttempts: number;
  lockoutMinutes: number;
}> {
  const all = await getAllSettings(db);
  return {
    maxAttempts: all.login_max_attempts as number,
    lockoutMinutes: all.login_lockout_minutes as number,
  };
}

export async function getSessionTimeoutMinutes(db: DbReader): Promise<number> {
  return getSettingValue<number>(db, "session_timeout_minutes");
}

export async function getMinPasswordLength(db: DbReader): Promise<number> {
  return getSettingValue<number>(db, "min_password_length");
}

export async function getProofUploadLimits(db: DbReader): Promise<{
  maxBytes: number;
  allowedTypes: string[];
}> {
  const all = await getAllSettings(db);
  const mb = all.proof_max_size_mb as number;
  return {
    maxBytes: mb * 1024 * 1024,
    allowedTypes: all.proof_allowed_types as string[],
  };
}

export async function getCompanyProfile(db: DbReader): Promise<{
  companyName: string;
  address: string;
  contactNumber: string;
  email: string;
  tin: string;
}> {
  const all = await getAllSettings(db);
  return {
    companyName: String(all.company_name ?? ""),
    address: String(all.company_address ?? ""),
    contactNumber: String(all.company_contact_number ?? ""),
    email: String(all.company_email ?? ""),
    tin: String(all.company_tin ?? ""),
  };
}

async function getSequenceLastNumber(
  db: DbReader,
  prefix: string,
): Promise<number> {
  const [row] = await db
    .select({ lastNumber: accountSequences.lastNumber })
    .from(accountSequences)
    .where(eq(accountSequences.prefix, prefix))
    .limit(1);
  return row?.lastNumber ?? 0;
}

function databaseNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "") || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

export function buildSystemInfo(config: AppConfig, apiBaseUrl: string) {
  return {
    appVersion: config.APP_VERSION,
    apiVersion: config.APP_VERSION,
    databaseName: databaseNameFromUrl(config.DATABASE_URL),
    apiBaseUrl,
    attachmentsPath: config.ATTACHMENTS_DIR ?? config.UPLOAD_DIR,
    backupsPath: config.BACKUPS_DIR,
  };
}

export async function getSettingsDto(
  db: DbWriter,
  config: AppConfig,
  options: { canManage: boolean; apiBaseUrl: string },
) {
  await ensureSettingDefaults(db);
  const settings = await getAllSettings(db);
  const invoicePrefix = String(settings.invoice_number_prefix);
  const receiptPrefix = String(settings.receipt_number_prefix);
  const [invoiceCounter, receiptCounter] = await Promise.all([
    getSequenceLastNumber(db, invoicePrefix),
    getSequenceLastNumber(db, receiptPrefix),
  ]);

  return {
    settings,
    meta: {
      receiptCounter,
      invoiceCounter,
      gcashDuplicatePolicy: GCASH_DUPLICATE_POLICY,
      canManage: options.canManage,
    },
    system: buildSystemInfo(config, options.apiBaseUrl),
  };
}

async function upsertSetting(
  db: DbWriter,
  key: SettingKey,
  value: unknown,
  actorUserId: string,
): Promise<{ oldValue: unknown; newValue: unknown }> {
  const [existing] = await db
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, key))
    .limit(1);

  const oldValue = existing
    ? coerceStored(key, existing.value)
    : SETTING_DEFAULTS[key];
  const parsed = parseSettingValue(key, value);
  if (!parsed.ok) {
    throw validationError("Invalid setting value.", {
      issues: [{ path: [key], message: parsed.message }],
    });
  }
  const newValue = parsed.value;

  if (existing) {
    await db
      .update(applicationSettings)
      .set({
        value: newValue,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(applicationSettings.key, key));
  } else {
    await db.insert(applicationSettings).values({
      key,
      value: newValue,
      updatedBy: actorUserId,
    });
  }

  return { oldValue, newValue };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function updateSettings(
  db: Db,
  actorUserId: string,
  patch: UpdateSettingsInput,
): Promise<{ changed: SettingKey[] }> {
  const keys = Object.keys(patch) as SettingKey[];
  if (keys.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "No settings to update.", {
      issues: [{ field: "_root", message: "Provide at least one setting." }],
    });
  }

  const changed: SettingKey[] = [];

  await db.transaction(async (tx) => {
    for (const key of keys) {
      const { oldValue, newValue } = await upsertSetting(
        tx,
        key,
        patch[key],
        actorUserId,
      );
      if (valuesEqual(oldValue, newValue)) continue;
      changed.push(key);
      await writeAuditLog(tx, {
        actorUserId,
        action: "settings.update",
        entityType: "application_setting",
        entityId: key,
        reason: `Updated ${SETTING_DEFS[key].label}`,
        oldValues: { [key]: oldValue },
        newValues: { [key]: newValue },
      });
    }
  });

  invalidateSettingsCache();
  return { changed };
}

export async function restoreSettingsSection(
  db: Db,
  actorUserId: string,
  section: SettingSection,
): Promise<{ restored: SettingKey[] }> {
  const keys = keysForSection(section);
  const restored: SettingKey[] = [];

  await db.transaction(async (tx) => {
    for (const key of keys) {
      const { oldValue, newValue } = await upsertSetting(
        tx,
        key,
        SETTING_DEFAULTS[key],
        actorUserId,
      );
      if (valuesEqual(oldValue, newValue)) continue;
      restored.push(key);
      await writeAuditLog(tx, {
        actorUserId,
        action: "settings.restore_defaults",
        entityType: "application_setting",
        entityId: key,
        reason: `Restored ${SETTING_DEFS[key].label} defaults (${section})`,
        oldValues: { [key]: oldValue },
        newValues: { [key]: newValue },
      });
    }
  });

  invalidateSettingsCache();
  return { restored };
}

export async function listSettingsChangeHistory(
  db: DbReader,
  query: { page: number; pageSize: number },
) {
  const where = and(
    eq(auditLogs.entityType, "application_setting"),
    sql`${auditLogs.action} in ('settings.update', 'settings.restore_defaults')`,
  );

  const [totalRow] = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(where);

  const offset = (query.page - 1) * query.pageSize;
  const rows = await db
    .select({
      id: auditLogs.id,
      entityId: auditLogs.entityId,
      oldValues: auditLogs.oldValues,
      newValues: auditLogs.newValues,
      actorUserId: auditLogs.actorUserId,
      actorName: users.fullName,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) => {
      const key = r.entityId ?? "";
      const oldBag = (r.oldValues ?? {}) as Record<string, unknown>;
      const newBag = (r.newValues ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        settingKey: key,
        oldValue: key ? oldBag[key] : r.oldValues,
        newValue: key ? newBag[key] : r.newValues,
        actorName: r.actorName ?? "",
        actorUserId: r.actorUserId,
        at: r.createdAt.toISOString(),
        action: r.action,
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.total ?? 0),
  };
}
