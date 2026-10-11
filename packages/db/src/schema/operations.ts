import {
  bigint,
  boolean,
  date,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { serviceAccounts } from "./service-accounts.js";

export const reconnectionStatusEnum = pgEnum("reconnection_status", [
  "PENDING",
  "COMPLETED",
  "CANCELLED",
]);

export const suspensionRecords = pgTable("suspension_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceAccountId: uuid("service_account_id")
    .notNull()
    .references(() => serviceAccounts.id),
  reason: text("reason").notNull(),
  effectiveDate: date("effective_date").notNull(),
  approvedBy: uuid("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reconnectionRecords = pgTable("reconnection_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceAccountId: uuid("service_account_id")
    .notNull()
    .references(() => serviceAccounts.id),
  suspensionId: uuid("suspension_id").references(() => suspensionRecords.id, {
    onDelete: "set null",
  }),
  feeCentavos: bigint("fee_centavos", { mode: "bigint" }).notNull().default(0n),
  technicianUserId: uuid("technician_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: reconnectionStatusEnum("status").notNull().default("PENDING"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const backupHistory = pgTable("backup_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(),
  backupPath: text("backup_path"),
  status: text("status").notNull(),
  verified: boolean("verified").notNull().default(false),
  checksumSha256: text("checksum_sha256"),
  sizeBytes: bigint("size_bytes", { mode: "bigint" }),
  message: text("message"),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SuspensionRecord = typeof suspensionRecords.$inferSelect;
export type ReconnectionRecord = typeof reconnectionRecords.$inferSelect;
export type BackupHistory = typeof backupHistory.$inferSelect;
