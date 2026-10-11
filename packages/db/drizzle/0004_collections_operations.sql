CREATE TYPE "public"."collection_batch_status" AS ENUM('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'REMITTED', 'RECONCILED', 'CLOSED');
CREATE TYPE "public"."reconnection_status" AS ENUM('PENDING', 'COMPLETED', 'CANCELLED');

CREATE TABLE IF NOT EXISTS "collection_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_number" text NOT NULL,
  "collector_user_id" uuid NOT NULL,
  "collection_area_id" uuid,
  "status" "collection_batch_status" DEFAULT 'OPEN' NOT NULL,
  "expected_cash_centavos" bigint DEFAULT 0 NOT NULL,
  "collected_cash_centavos" bigint DEFAULT 0 NOT NULL,
  "collected_non_cash_centavos" bigint DEFAULT 0 NOT NULL,
  "remitted_cash_centavos" bigint,
  "difference_centavos" bigint,
  "shortage_reason" text,
  "notes" text,
  "created_by" uuid,
  "closed_by" uuid,
  "closed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "collection_batches_batch_number_unique" UNIQUE("batch_number")
);

CREATE TABLE IF NOT EXISTS "collection_batch_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "service_account_id" uuid,
  "expected_centavos" bigint DEFAULT 0 NOT NULL,
  "collected_centavos" bigint DEFAULT 0 NOT NULL,
  "payment_id" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "collector_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "collector_user_id" uuid NOT NULL,
  "collection_area_id" uuid NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "assigned_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "suspension_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_account_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "effective_date" date NOT NULL,
  "approved_by" uuid,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "reconnection_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_account_id" uuid NOT NULL,
  "suspension_id" uuid,
  "fee_centavos" bigint DEFAULT 0 NOT NULL,
  "technician_user_id" uuid,
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "status" "reconnection_status" DEFAULT 'PENDING' NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "backup_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action" text NOT NULL,
  "backup_path" text,
  "status" text NOT NULL,
  "verified" boolean DEFAULT false NOT NULL,
  "checksum_sha256" text,
  "size_bytes" bigint,
  "message" text,
  "actor_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_collector_user_id_users_id_fk"
    FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_collection_area_id_collection_areas_id_fk"
    FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_closed_by_users_id_fk"
    FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_batch_id_collection_batches_id_fk"
    FOREIGN KEY ("batch_id") REFERENCES "public"."collection_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_subscriber_id_subscribers_id_fk"
    FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_service_account_id_service_accounts_id_fk"
    FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collection_batch_accounts" ADD CONSTRAINT "collection_batch_accounts_payment_id_payments_id_fk"
    FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collector_assignments" ADD CONSTRAINT "collector_assignments_collector_user_id_users_id_fk"
    FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "collector_assignments" ADD CONSTRAINT "collector_assignments_collection_area_id_collection_areas_id_fk"
    FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_service_account_id_service_accounts_id_fk"
    FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "suspension_records" ADD CONSTRAINT "suspension_records_approved_by_users_id_fk"
    FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_service_account_id_service_accounts_id_fk"
    FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_suspension_id_suspension_records_id_fk"
    FOREIGN KEY ("suspension_id") REFERENCES "public"."suspension_records"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "reconnection_records" ADD CONSTRAINT "reconnection_records_technician_user_id_users_id_fk"
    FOREIGN KEY ("technician_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "backup_history" ADD CONSTRAINT "backup_history_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Insert-only: block UPDATE/DELETE on backup_history (mirrors audit_logs).
CREATE OR REPLACE FUNCTION prevent_backup_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'backup_history is insert-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS backup_history_no_update ON backup_history;
CREATE TRIGGER backup_history_no_update
  BEFORE UPDATE ON backup_history
  FOR EACH ROW EXECUTE FUNCTION prevent_backup_history_mutation();

DROP TRIGGER IF EXISTS backup_history_no_delete ON backup_history;
CREATE TRIGGER backup_history_no_delete
  BEFORE DELETE ON backup_history
  FOR EACH ROW EXECUTE FUNCTION prevent_backup_history_mutation();
