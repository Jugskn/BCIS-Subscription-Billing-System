CREATE TYPE "public"."billing_cycle_status" AS ENUM('OPEN', 'GENERATED', 'CLOSED');
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID', 'CREDITED');
CREATE TYPE "public"."invoice_item_type" AS ENUM('SUBSCRIPTION', 'INSTALLATION_FEE', 'RECONNECTION_FEE', 'DISCOUNT', 'PENALTY', 'ADJUSTMENT');
CREATE TYPE "public"."adjustment_type" AS ENUM('DEBIT', 'CREDIT');
CREATE TYPE "public"."ledger_reference_type" AS ENUM('INVOICE', 'PAYMENT', 'ADJUSTMENT', 'CREDIT_APPLICATION', 'INVOICE_VOID', 'CREDIT');

CREATE TABLE IF NOT EXISTS "billing_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "billing_period" text NOT NULL,
  "status" "billing_cycle_status" DEFAULT 'OPEN' NOT NULL,
  "generated_at" timestamptz,
  "generated_by" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "billing_cycles_billing_period_unique" UNIQUE("billing_period")
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" text NOT NULL,
  "service_account_id" uuid NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "billing_cycle_id" uuid,
  "billing_period" text NOT NULL,
  "status" "invoice_status" DEFAULT 'UNPAID' NOT NULL,
  "due_date" date NOT NULL,
  "subtotal_centavos" bigint NOT NULL,
  "discount_centavos" bigint DEFAULT 0 NOT NULL,
  "penalty_centavos" bigint DEFAULT 0 NOT NULL,
  "adjustment_centavos" bigint DEFAULT 0 NOT NULL,
  "total_centavos" bigint NOT NULL,
  "paid_centavos" bigint DEFAULT 0 NOT NULL,
  "credit_applied_centavos" bigint DEFAULT 0 NOT NULL,
  "balance_centavos" bigint NOT NULL,
  "void_reason" text,
  "voided_at" timestamptz,
  "voided_by" uuid,
  "issued_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);

CREATE TABLE IF NOT EXISTS "invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "item_type" "invoice_item_type" NOT NULL,
  "description" text NOT NULL,
  "rate_centavos" bigint NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "amount_centavos" bigint NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "adjustment_type" "adjustment_type" NOT NULL,
  "amount_centavos" bigint NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "service_account_id" uuid,
  "entry_date" date NOT NULL,
  "reference_type" "ledger_reference_type" NOT NULL,
  "reference_id" uuid NOT NULL,
  "description" text NOT NULL,
  "debit_centavos" bigint DEFAULT 0 NOT NULL,
  "credit_centavos" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscriber_credits" (
  "subscriber_id" uuid PRIMARY KEY NOT NULL,
  "unapplied_centavos" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "billing_cycles"
  ADD CONSTRAINT "billing_cycles_generated_by_users_id_fk"
  FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_service_account_id_service_accounts_id_fk"
  FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_billing_cycle_id_billing_cycles_id_fk"
  FOREIGN KEY ("billing_cycle_id") REFERENCES "public"."billing_cycles"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_voided_by_users_id_fk"
  FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "adjustments"
  ADD CONSTRAINT "adjustments_invoice_id_invoices_id_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "adjustments"
  ADD CONSTRAINT "adjustments_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "adjustments"
  ADD CONSTRAINT "adjustments_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_service_account_id_service_accounts_id_fk"
  FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "subscriber_credits"
  ADD CONSTRAINT "subscriber_credits_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_service_account_period_active_idx"
  ON "invoices" ("service_account_id", "billing_period")
  WHERE "status" <> 'VOID';

CREATE INDEX IF NOT EXISTS "invoices_subscriber_idx" ON "invoices" ("subscriber_id");
CREATE INDEX IF NOT EXISTS "invoices_due_date_status_idx" ON "invoices" ("due_date", "status");
CREATE INDEX IF NOT EXISTS "invoices_billing_period_idx" ON "invoices" ("billing_period");
CREATE INDEX IF NOT EXISTS "ledger_entries_subscriber_date_idx" ON "ledger_entries" ("subscriber_id", "entry_date");
CREATE INDEX IF NOT EXISTS "ledger_entries_reference_idx" ON "ledger_entries" ("reference_type", "reference_id");

INSERT INTO "account_sequences" ("prefix", "last_number") VALUES ('INV', 0)
ON CONFLICT ("prefix") DO NOTHING;
