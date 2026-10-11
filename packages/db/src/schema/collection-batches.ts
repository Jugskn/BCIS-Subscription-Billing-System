import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { collectionAreas } from "./collections.js";
import { subscribers } from "./subscribers.js";
import { serviceAccounts } from "./service-accounts.js";
import { payments } from "./payments.js";

export const collectionBatchStatusEnum = pgEnum("collection_batch_status", [
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "REMITTED",
  "RECONCILED",
  "CLOSED",
]);

export const collectionBatches = pgTable("collection_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  collectorUserId: uuid("collector_user_id")
    .notNull()
    .references(() => users.id),
  collectionAreaId: uuid("collection_area_id").references(() => collectionAreas.id, {
    onDelete: "set null",
  }),
  status: collectionBatchStatusEnum("status").notNull().default("OPEN"),
  expectedCashCentavos: bigint("expected_cash_centavos", { mode: "bigint" })
    .notNull()
    .default(0n),
  collectedCashCentavos: bigint("collected_cash_centavos", { mode: "bigint" })
    .notNull()
    .default(0n),
  collectedNonCashCentavos: bigint("collected_non_cash_centavos", {
    mode: "bigint",
  })
    .notNull()
    .default(0n),
  remittedCashCentavos: bigint("remitted_cash_centavos", { mode: "bigint" }),
  differenceCentavos: bigint("difference_centavos", { mode: "bigint" }),
  shortageReason: text("shortage_reason"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  closedBy: uuid("closed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const collectionBatchAccounts = pgTable("collection_batch_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => collectionBatches.id),
  subscriberId: uuid("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  serviceAccountId: uuid("service_account_id").references(() => serviceAccounts.id, {
    onDelete: "set null",
  }),
  expectedCentavos: bigint("expected_centavos", { mode: "bigint" })
    .notNull()
    .default(0n),
  collectedCentavos: bigint("collected_centavos", { mode: "bigint" })
    .notNull()
    .default(0n),
  paymentId: uuid("payment_id").references(() => payments.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CollectionBatch = typeof collectionBatches.$inferSelect;
export type NewCollectionBatch = typeof collectionBatches.$inferInsert;
export type CollectionBatchAccount = typeof collectionBatchAccounts.$inferSelect;
