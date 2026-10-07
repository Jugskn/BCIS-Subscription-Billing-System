import {
  bigint,
  index,
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
import { invoices } from "./billing.js";

export const paymentMethodEnum = pgEnum("payment_method", [
  "Cash",
  "GCash",
  "BankTransfer",
  "Cheque",
  "Other",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "POSTED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "REVERSED",
]);

export const receiptStatusEnum = pgEnum("receipt_status", ["ISSUED", "VOID"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    method: paymentMethodEnum("method").notNull(),
    amountCentavos: bigint("amount_centavos", { mode: "bigint" }).notNull(),
    unallocatedCentavos: bigint("unallocated_centavos", { mode: "bigint" })
      .notNull()
      .default(0n),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    referenceNumber: text("reference_number"),
    senderName: text("sender_name"),
    status: paymentStatusEnum("status").notNull().default("POSTED"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedBy: uuid("verified_by").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_gcash_ref_active_idx")
      .on(table.referenceNumber)
      .where(
        sql`${table.method} = 'GCash' AND ${table.referenceNumber} IS NOT NULL AND ${table.status} IN ('PENDING', 'VERIFIED')`,
      ),
    index("payments_subscriber_idx").on(table.subscriberId),
    index("payments_received_at_idx").on(table.receivedAt),
    index("payments_status_idx").on(table.status),
    index("payments_reference_idx").on(table.referenceNumber),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amountCentavos: bigint("amount_centavos", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("payment_allocations_payment_idx").on(table.paymentId),
    index("payment_allocations_invoice_idx").on(table.invoiceId),
  ],
);

export const paymentProofs = pgTable("payment_proofs", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id, { onDelete: "cascade" }),
  originalFilename: text("original_filename").notNull(),
  storedFilename: text("stored_filename").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentReversals = pgTable("payment_reversals", {
  id: uuid("id").defaultRandom().primaryKey(),
  originalPaymentId: uuid("original_payment_id")
    .notNull()
    .references(() => payments.id),
  reason: text("reason").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const receipts = pgTable("receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  receiptNumber: text("receipt_number").notNull().unique(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => payments.id),
  subscriberId: uuid("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  status: receiptStatusEnum("status").notNull().default("ISSUED"),
  amountCentavos: bigint("amount_centavos", { mode: "bigint" }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  issuedBy: uuid("issued_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type PaymentProof = typeof paymentProofs.$inferSelect;
export type PaymentReversal = typeof paymentReversals.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
