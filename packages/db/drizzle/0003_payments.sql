CREATE TYPE "public"."payment_method" AS ENUM('Cash', 'GCash', 'BankTransfer', 'Cheque', 'Other');
CREATE TYPE "public"."payment_status" AS ENUM('POSTED', 'PENDING', 'VERIFIED', 'REJECTED', 'REVERSED');
CREATE TYPE "public"."receipt_status" AS ENUM('ISSUED', 'VOID');

ALTER TYPE "public"."ledger_reference_type" ADD VALUE IF NOT EXISTS 'PAYMENT_REVERSAL';

CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "method" "payment_method" NOT NULL,
  "amount_centavos" bigint NOT NULL,
  "unallocated_centavos" bigint DEFAULT 0 NOT NULL,
  "received_at" timestamptz NOT NULL,
  "reference_number" text,
  "sender_name" text,
  "status" "payment_status" DEFAULT 'POSTED' NOT NULL,
  "idempotency_key" text NOT NULL,
  "notes" text,
  "rejection_reason" text,
  "actor_user_id" uuid,
  "verified_by" uuid,
  "verified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);

CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "amount_centavos" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_proofs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "original_filename" text NOT NULL,
  "stored_filename" text NOT NULL,
  "storage_path" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_reversals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "original_payment_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_number" text NOT NULL,
  "payment_id" uuid NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "status" "receipt_status" DEFAULT 'ISSUED' NOT NULL,
  "amount_centavos" bigint NOT NULL,
  "issued_at" timestamptz DEFAULT now() NOT NULL,
  "voided_at" timestamptz,
  "void_reason" text,
  "issued_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "receipts_receipt_number_unique" UNIQUE("receipt_number")
);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_verified_by_users_id_fk"
  FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_uploaded_by_users_id_fk"
  FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "payment_reversals"
  ADD CONSTRAINT "payment_reversals_original_payment_id_payments_id_fk"
  FOREIGN KEY ("original_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "payment_reversals"
  ADD CONSTRAINT "payment_reversals_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_payment_id_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_issued_by_users_id_fk"
  FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_gcash_ref_active_idx"
  ON "payments" ("reference_number")
  WHERE "method" = 'GCash'
    AND "reference_number" IS NOT NULL
    AND "status" IN ('PENDING', 'VERIFIED');

CREATE INDEX IF NOT EXISTS "payments_subscriber_idx" ON "payments" ("subscriber_id");
CREATE INDEX IF NOT EXISTS "payments_received_at_idx" ON "payments" ("received_at");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" ("status");
CREATE INDEX IF NOT EXISTS "payments_reference_idx" ON "payments" ("reference_number");
CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx" ON "payment_allocations" ("payment_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_idx" ON "payment_allocations" ("invoice_id");
CREATE INDEX IF NOT EXISTS "receipts_payment_idx" ON "receipts" ("payment_id");
CREATE INDEX IF NOT EXISTS "receipts_subscriber_idx" ON "receipts" ("subscriber_id");

INSERT INTO "account_sequences" ("prefix", "last_number") VALUES ('RCPT', 0)
ON CONFLICT ("prefix") DO NOTHING;
