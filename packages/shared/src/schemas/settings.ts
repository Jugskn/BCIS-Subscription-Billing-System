import { z } from "zod";
import { PAYMENT_METHODS } from "../billing/allocation.js";
import { paginationQuerySchema } from "./users.js";
import {
  normalizePhilippineMobile,
  philippineMobileSchema,
} from "./subscribers.js";

export const SETTING_SECTIONS = [
  "company",
  "billing",
  "receivables",
  "payments",
  "security",
] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];

export const PENALTY_TYPES = ["fixed", "percent"] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PROOF_FILE_TYPES = ["jpg", "png", "pdf"] as const;
export type ProofFileType = (typeof PROOF_FILE_TYPES)[number];

/** Hard-coded GCash duplicate policy (not editable). */
export const GCASH_DUPLICATE_POLICY =
  "Hard block on PENDING/VERIFIED references" as const;

const optionalTin = z
  .string()
  .trim()
  .max(32)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v === "" || v === undefined ? "" : v));

const companyContactSchema = z
  .string()
  .trim()
  .transform(normalizePhilippineMobile)
  .refine(
    (value) => /^\+639\d{9}$/.test(value),
    "Enter a valid Philippine mobile number (+63 format).",
  );

/** Typed catalog: key, Zod type, default, and human label. */
export const SETTING_DEFS = {
  company_name: {
    section: "company" as const,
    label: "Company name",
    schema: z.string().trim().min(1).max(200),
    default: "BCIS Lab",
  },
  company_address: {
    section: "company" as const,
    label: "Address",
    schema: z.string().trim().max(500),
    default: "",
  },
  company_contact_number: {
    section: "company" as const,
    label: "Contact number",
    schema: companyContactSchema,
    default: "+639171234567",
  },
  company_email: {
    section: "company" as const,
    label: "Email",
    schema: z.string().trim().email().max(200).or(z.literal("")),
    default: "",
  },
  company_tin: {
    section: "company" as const,
    label: "TIN",
    schema: optionalTin,
    default: "",
  },
  default_due_day: {
    section: "billing" as const,
    label: "Default due day",
    schema: z.coerce.number().int().min(1).max(28),
    default: 15,
  },
  invoice_number_prefix: {
    section: "billing" as const,
    label: "Invoice number prefix",
    schema: z
      .string()
      .trim()
      .min(1)
      .max(12)
      .regex(/^[A-Z0-9]+$/, "Prefix must be uppercase letters or digits."),
    default: "INV",
  },
  billing_generation_day_note: {
    section: "billing" as const,
    label: "Billing generation day note",
    schema: z.string().trim().max(500),
    default: "Generate invoices on the 1st of each month.",
  },
  penalties_enabled: {
    section: "billing" as const,
    label: "Enable penalties",
    schema: z.boolean(),
    default: false,
  },
  penalty_type: {
    section: "billing" as const,
    label: "Penalty type",
    schema: z.enum(PENALTY_TYPES),
    default: "fixed" as PenaltyType,
  },
  /** Fixed: centavos. Percent: integer percent 0–100. */
  penalty_value: {
    section: "billing" as const,
    label: "Penalty value",
    schema: z.coerce.number().int().min(0).max(100_000_000),
    default: 0,
  },
  reconnection_fee_default_centavos: {
    section: "billing" as const,
    label: "Reconnection fee default",
    schema: z.coerce.number().int().min(0).max(100_000_000),
    default: 0,
  },
  installation_fee_default_centavos: {
    section: "billing" as const,
    label: "Installation fee default",
    schema: z.coerce.number().int().min(0).max(100_000_000),
    default: 0,
  },
  grace_days: {
    section: "receivables" as const,
    label: "Grace period (days)",
    schema: z.coerce.number().int().min(0).max(90),
    default: 5,
  },
  suspension_threshold_months: {
    section: "receivables" as const,
    label: "Suspension threshold (months unpaid)",
    schema: z.coerce.number().int().min(0).max(60),
    default: 3,
  },
  suspension_threshold_centavos: {
    section: "receivables" as const,
    label: "Suspension threshold (amount)",
    schema: z.coerce.number().int().min(0).max(100_000_000_000),
    default: 200_000,
  },
  follow_up_threshold_days: {
    section: "receivables" as const,
    label: "Follow-up threshold (days)",
    schema: z.coerce.number().int().min(0).max(365),
    default: 7,
  },
  receipt_number_prefix: {
    section: "payments" as const,
    label: "Receipt number prefix",
    schema: z
      .string()
      .trim()
      .min(1)
      .max(12)
      .regex(/^[A-Z0-9]+$/, "Prefix must be uppercase letters or digits."),
    default: "RCPT",
  },
  enabled_payment_methods: {
    section: "payments" as const,
    label: "Enabled payment methods",
    schema: z.array(z.enum(PAYMENT_METHODS)).min(1),
    default: [...PAYMENT_METHODS] as (typeof PAYMENT_METHODS)[number][],
  },
  proof_max_size_mb: {
    section: "payments" as const,
    label: "Proof max size (MB)",
    schema: z.coerce.number().int().min(1).max(50),
    default: 5,
  },
  proof_allowed_types: {
    section: "payments" as const,
    label: "Proof allowed types",
    schema: z.array(z.enum(PROOF_FILE_TYPES)).min(1),
    default: [...PROOF_FILE_TYPES] as ProofFileType[],
  },
  session_timeout_minutes: {
    section: "security" as const,
    label: "Session timeout / auto-lock (minutes)",
    schema: z.coerce.number().int().min(1).max(480),
    default: 30,
  },
  login_max_attempts: {
    section: "security" as const,
    label: "Max failed logins",
    schema: z.coerce.number().int().min(1).max(50),
    default: 5,
  },
  login_lockout_minutes: {
    section: "security" as const,
    label: "Lockout minutes",
    schema: z.coerce.number().int().min(1).max(1440),
    default: 15,
  },
  min_password_length: {
    section: "security" as const,
    label: "Minimum password length",
    schema: z.coerce.number().int().min(8).max(128),
    default: 8,
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export const SETTING_DEFAULTS: Record<SettingKey, unknown> = Object.fromEntries(
  SETTING_KEYS.map((key) => [key, SETTING_DEFS[key].default]),
) as Record<SettingKey, unknown>;

export function keysForSection(section: SettingSection): SettingKey[] {
  return SETTING_KEYS.filter((key) => SETTING_DEFS[key].section === section);
}

export function parseSettingValue(
  key: SettingKey,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const parsed = SETTING_DEFS[key].schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid value",
    };
  }
  return { ok: true, value: parsed.data };
}

/** Partial update body: only known keys; unknown keys rejected at route level. */
export const updateSettingsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (!(key in SETTING_DEFS)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown setting key: ${key}`,
          path: [key],
        });
        continue;
      }
      const result = parseSettingValue(key as SettingKey, obj[key]);
      if (!result.ok) {
        ctx.addIssue({
          code: "custom",
          message: result.message,
          path: [key],
        });
      }
    }
  })
  .transform((obj) => {
    const out: Partial<Record<SettingKey, unknown>> = {};
    for (const [key, raw] of Object.entries(obj)) {
      if (!(key in SETTING_DEFS)) continue;
      const result = parseSettingValue(key as SettingKey, raw);
      if (result.ok) out[key as SettingKey] = result.value;
    }
    return out;
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const restoreSettingsSectionSchema = z.object({
  section: z.enum(SETTING_SECTIONS),
});

export type RestoreSettingsSectionInput = z.infer<
  typeof restoreSettingsSectionSchema
>;

export const settingsHistoryQuerySchema = paginationQuerySchema;

export const companyContactDisplaySchema = philippineMobileSchema;

export type SettingsMap = Record<SettingKey, unknown>;

export type SettingsDto = {
  settings: SettingsMap;
  meta: {
    receiptCounter: number;
    invoiceCounter: number;
    gcashDuplicatePolicy: typeof GCASH_DUPLICATE_POLICY;
    canManage: boolean;
  };
  system: {
    appVersion: string;
    apiVersion: string;
    databaseName: string;
    apiBaseUrl: string;
    attachmentsPath: string;
    backupsPath: string;
  };
};

export type SettingsHistoryItem = {
  id: string;
  settingKey: string;
  oldValue: unknown;
  newValue: unknown;
  actorName: string;
  actorUserId: string | null;
  at: string;
};
