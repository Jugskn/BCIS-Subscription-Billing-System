import {
  bigint,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";
import { subscribers } from "./subscribers.js";
import { serviceAccounts } from "./service-accounts.js";

export const billingCycleStatusEnum = pgEnum("billing_cycle_status", [
  "OPEN",
  "GENERATED",
  "CLOSED",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "DRAFT",
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
  "CREDITED",
]);

export const invoiceItemTypeEnum = pgEnum("invoice_item_type", [
  "SUBSCRIPTION",
  "INSTALLATION_FEE",
  "RECONNECTION_FEE",
  "DISCOUNT",
  "PENALTY",
  "ADJUSTMENT",
]);

export const adjustmentTypeEnum = pgEnum("adjustment_type", ["DEBIT", "CREDIT"]);

export const ledgerReferenceTypeEnum = pgEnum("ledger_reference_type", [
  "INVOICE",
  "PAYMENT",
  "PAYMENT_REVERSAL",
  "ADJUSTMENT",
  "CREDIT_APPLICATION",
  "INVOICE_VOID",
  "CREDIT",
]);

export const billingCycles = pgTable("billing_cycles", {
  id: uuid("id").defaultRandom().primaryKey(),
  billingPeriod: text("billing_period").notNull().unique(),
  status: billingCycleStatusEnum("status").notNull().default("OPEN"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  generatedBy: uuid("generated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    serviceAccountId: uuid("service_account_id")
      .notNull()
      .references(() => serviceAccounts.id),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    billingCycleId: uuid("billing_cycle_id").references(() => billingCycles.id, {
      onDelete: "set null",
    }),
    billingPeriod: text("billing_period").notNull(),
    status: invoiceStatusEnum("status").notNull().default("UNPAID"),
    dueDate: date("due_date").notNull(),
    subtotalCentavos: bigint("subtotal_centavos", { mode: "bigint" }).notNull(),
    discountCentavos: bigint("discount_centavos", { mode: "bigint" })
      .notNull()
      .default(0n),
    penaltyCentavos: bigint("penalty_centavos", { mode: "bigint" })
      .notNull()
      .default(0n),
    adjustmentCentavos: bigint("adjustment_centavos", { mode: "bigint" })
      .notNull()
      .default(0n),
    totalCentavos: bigint("total_centavos", { mode: "bigint" }).notNull(),
    paidCentavos: bigint("paid_centavos", { mode: "bigint" }).notNull().default(0n),
    creditAppliedCentavos: bigint("credit_applied_centavos", { mode: "bigint" })
      .notNull()
      .default(0n),
    balanceCentavos: bigint("balance_centavos", { mode: "bigint" }).notNull(),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_service_account_period_active_idx")
      .on(table.serviceAccountId, table.billingPeriod)
      .where(sql`${table.status} <> 'VOID'`),
  ],
);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  itemType: invoiceItemTypeEnum("item_type").notNull(),
  description: text("description").notNull(),
  rateCentavos: bigint("rate_centavos", { mode: "bigint" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  amountCentavos: bigint("amount_centavos", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adjustments = pgTable("adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  subscriberId: uuid("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  adjustmentType: adjustmentTypeEnum("adjustment_type").notNull(),
  amountCentavos: bigint("amount_centavos", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  subscriberId: uuid("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  serviceAccountId: uuid("service_account_id").references(() => serviceAccounts.id, {
    onDelete: "set null",
  }),
  entryDate: date("entry_date").notNull(),
  referenceType: ledgerReferenceTypeEnum("reference_type").notNull(),
  referenceId: uuid("reference_id").notNull(),
  description: text("description").notNull(),
  debitCentavos: bigint("debit_centavos", { mode: "bigint" }).notNull().default(0n),
  creditCentavos: bigint("credit_centavos", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const subscriberCredits = pgTable("subscriber_credits", {
  subscriberId: uuid("subscriber_id")
    .primaryKey()
    .references(() => subscribers.id),
  unappliedCentavos: bigint("unapplied_centavos", { mode: "bigint" })
    .notNull()
    .default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BillingCycle = typeof billingCycles.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type Adjustment = typeof adjustments.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type SubscriberCredit = typeof subscriberCredits.$inferSelect;
